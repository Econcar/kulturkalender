// Berwaldhallen.
//
// Next.js. Kalendern (/kalender) ritas i webbläsaren, men dess inbäddade data
// bär alla konserter som adresser: konsert/<slug> (47 vid undersökningen
// 2026-09-27). Varje konsertsida har ld+json EventSeries med ett subEvent per
// föreställning - startDate med zon, plats och bild. Nivå 1, bara ett steg ner.
//
// Radiosymfonikerna och Radiokören spelar också på andra scener. subEvent med
// en annan plats än Berwaldhallen hoppas över.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { extractAllJsonLd } from '../../lib/ldjson.mjs';
import { toEvent } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://www.berwaldhallen.se';

export default {
  id: 'berwaldhallen',
  label: 'Berwaldhallen',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(`${BAS}/kalender`))) throw new Error('robots.txt tillåter inte hämtning');

    const adresser = concertUrls(await hämta(`${BAS}/kalender`));
    log(`  ${adresser.length} konsertsidor i kalendern`);
    if (!adresser.length) throw new Error('kalendern bar inga konserter - formatet kan ha ändrats');

    const ut = [];
    for (const url of adresser) {
      await paus(1200);
      try {
        ut.push(...eventsFromPage(await hämta(url), url));
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
      }
    }
    return ut;
  },
};

/** Konsertadresserna, var de än står - i länkar eller i den inbäddade datan. */
export function concertUrls(html) {
  const ut = new Set();
  for (const m of String(html ?? '').matchAll(/konsert\/([a-z0-9-]{3,})/g)) ut.add(`${BAS}/konsert/${m[1]}`);
  return [...ut];
}

/** Föreställningarna på en konsertsida. */
export function eventsFromPage(html, url) {
  const serie = extractAllJsonLd(html).find((n) => [].concat(n?.['@type']).includes('EventSeries'));
  if (!serie) return [];

  const ut = [];
  for (const sub of [].concat(serie.subEvent ?? [])) {
    const plats = clean(sub?.location?.name) ?? '';
    if (plats && !/berwald/i.test(plats)) continue;

    const rad = toEvent({ ...sub, image: sub.image ?? serie.image, offers: sub.offers ?? serie.offers }, { sourceUrl: url });
    if (!rad) continue;
    const id = /\/event\/(\d+)/.exec(sub['@id'] ?? '')?.[1];
    ut.push({
      ...rad,
      url,
      // ld+json säger Event, inte MusicEvent. Berwaldhallen är ett konserthus.
      category: rad.category === 'övrigt' ? 'konsert' : rad.category,
      venue_raw: null,
      organizer: 'Berwaldhallen',
      external_id: id ?? `${new URL(url).pathname.split('/').pop()}/${rad.starts_at.slice(0, 16)}`,
    });
  }
  return ut;
}

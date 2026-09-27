// Fotografiska Stockholm.
//
// Nivå 1: varje utställningssida bär ld+json @type ExhibitionEvent med namn,
// beskrivning, startDate och endDate. Listorna över pågående och kommande
// (/sv/utstallningar/current och /upcoming) länkar till sidorna, som ligger
// under /sv/exhibitions/<slug>. Undersökt 2026-09-27; robots.txt: Allow: /.
//
// Datumen skrivs som midnatt UTC ("2026-04-25T00:00:00.000Z") men menar en
// dag. Tolkade rakt blev de 02:00 svensk tid; de läses därför som datum, och
// slutdagen räknas hela dagen.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { eventNodes, parseDateTime, toEvent } from '../../lib/event.mjs';

const BAS = 'https://stockholm.fotografiska.com';
const LISTOR = [`${BAS}/sv/utstallningar/current`, `${BAS}/sv/utstallningar/upcoming`];

export default {
  id: 'fotografiska',
  label: 'Fotografiska',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(LISTOR[0]))) throw new Error('robots.txt tillåter inte utställningssidorna');

    const adresser = new Set();
    for (const lista of LISTOR) {
      for (const url of exhibitionUrls(await hämta(lista))) adresser.add(url);
      await paus(1000);
    }
    log(`  ${adresser.size} utställningssidor att hämta`);
    if (!adresser.size) throw new Error('listorna länkade inga utställningar - formatet kan ha ändrats');

    const ut = [];
    for (const url of adresser) {
      let html;
      try {
        html = await hämta(url);
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
        continue;
      }
      const rad = rowFromPage(html, url);
      if (rad) ut.push(rad);
      await paus(1200);
    }
    return ut;
  },
};

/** Utställningssidorna i en lista. */
export function exhibitionUrls(html) {
  const ut = new Set();
  for (const m of String(html ?? '').matchAll(/href="(?:https:\/\/stockholm\.fotografiska\.com)?(\/sv\/exhibitions\/[a-z0-9-]+)"/g)) {
    ut.add(`${BAS}${m[1]}`);
  }
  return [...ut];
}

/** En utställningssida till en rad, med datumen lästa som dagar. */
export function rowFromPage(html, url) {
  const nod = eventNodes(html).find((n) => /Exhibition/.test([].concat(n['@type']).join()));
  if (!nod) return null;
  const rad = toEvent(nod, { sourceUrl: url });
  if (!rad) return null;

  const start = dag(nod.startDate);
  const slut = dag(nod.endDate);
  return {
    ...rad,
    url,
    category: 'utställning',
    venue_raw: null,
    starts_at: start ?? rad.starts_at,
    ends_at: slut ? new Date(new Date(slut).getTime() + 86_400_000 - 60_000).toISOString() : null,
    organizer: 'Fotografiska',
    external_id: new URL(url).pathname.split('/').pop(),
  };
}

/** "2026-04-25T00:00:00.000Z" som midnatt svensk tid samma datum. */
function dag(värde) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(värde ?? ''));
  return m ? parseDateTime(m[1]) : null;
}

// Teater Galeasen, Skeppsholmen.
//
// Varje uppsättning har en egen sida (/vernonsubutex/) där föreställningarna
// står som biljettknappar:
//
//   <a class="tickets__item" href="https://tickets.nortic.se/ticket/show/350916">
//     <p class="tickets__name"><span>Måndag 05 Oktober kl 18.00</span></p>
//     <p class="tickets__status">Slutsålt</p>
//
// Året saknas och tas från premiären, som sidan skriver ut ("Urpremiär 5
// oktober 2026"); veckodagen bekräftar det.
//
// Uppsättningssidorna hittas via startsidans länkar. Listan /forestallningar/
// ser ut att vara rätt ställe men är pressarkivet: dess länkar går till
// pressidor utan biljettknappar.
//
// Nortic, där biljetterna säljs, gick inte att använda som för Giljotin:
// teaterns Nortic-länk ledde till arrangörssidan, som ritas i webbläsaren och
// inte bär några föreställningar. Undersökt 2026-10-04.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { datumUtanÅr, parseSwedishDate } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://galeasen.se';

export default {
  id: 'galeasen',
  label: 'Teater Galeasen',
  enabled: true,
  // Mellan säsongerna spelas ingenting. Att startsidan går att läsa vaktas nedan.
  kanVaraTom: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
    if (!(await robotsOk(`${BAS}/`))) throw new Error('robots.txt tillåter inte teaterns sidor');

    const sidor = startsidansSidor(await hämta(`${BAS}/`));
    if (!sidor.length) throw new Error('startsidan länkade inga sidor - formatet kan ha ändrats');

    // Alla startsidans sidor läses; de som har biljettknappar är uppsättningar.
    const ut = [];
    let medKnappar = 0;
    for (const url of sidor) {
      await paus(1200);
      try {
        const rader = föreställningar(await hämta(url), { now });
        if (rader.length) medKnappar += 1;
        ut.push(...rader);
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
      }
    }
    log(`  ${sidor.length} sidor från startsidan, ${medKnappar} med föreställningar`);
    return ut;
  },
};

/** Startsidans sidor ett led ned, utom flöden och API. */
export function startsidansSidor(html) {
  const slugar = [...String(html ?? '').matchAll(/href="https?:\/\/galeasen\.se\/([a-z0-9-]+)\/?"/g)].map((m) => m[1]);
  return [...new Set(slugar)]
    .filter((s) => !['feed', 'wp-json', 'wp-admin', 'wp-login'].includes(s))
    .map((s) => `${BAS}/${s}/`);
}

/** En uppsättningssida till rader, en per föreställning. */
export function föreställningar(html, { now = new Date() } = {}) {
  const text = String(html ?? '');
  const meta = (namn) => clean(new RegExp(`<meta property="og:${namn}" content="([^"]*)"`).exec(text)?.[1]);
  const titel = meta('title');
  const url = /<link rel="canonical" href="([^"]+)"/.exec(text)?.[1] ?? meta('url');
  if (!titel || !url) return [];
  const slug = url.split('/').filter(Boolean).pop();
  const premiär = parseSwedishDate(/premiär[^0-9<]{0,10}\d{1,2}\s+[a-zåäö]+\s+\d{4}/i.exec(text)?.[0]);

  // Året räknas från premiären, med två månader för förhandsvisningarna.
  // Saknas den står bara kommande kvällar på sidan, och då räknas från i dag.
  const från = premiär ? new Date(premiär).getTime() : now.getTime();
  const efter = new Date(från - 60 * 86_400_000).toISOString();

  const ut = [];
  const knapp = /<a[^>]*class="tickets__item"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const [, biljett, inre] of text.matchAll(knapp)) {
    const när = clean(/tickets__name[^>]*>([\s\S]*?)<\/p>/.exec(inre)?.[1]);
    const status = clean(/tickets__status[^>]*>([\s\S]*?)<\/p>/.exec(inre)?.[1]) ?? '';
    const m = /^(\p{L}+)\s+(\d{1,2})\s+(\p{L}+)\s+kl\s*(\d{1,2}[.:]\d{2})/u.exec(när ?? '');
    if (!m) continue;
    const starts_at = datumUtanÅr({ veckodag: m[1], dag: m[2], månad: m[3], tid: m[4], efter });
    if (!starts_at) continue;

    ut.push({
      url,
      title: titel,
      description: meta('description'),
      image_url: meta('image'),
      category: 'teater',
      genre: null,
      venue_raw: null,
      address: null,
      starts_at,
      ends_at: null,
      premiere_at: premiär,
      price_min: null,
      price_max: null,
      currency: 'SEK',
      ticket_url: biljett,
      status: /inställ/i.test(status) ? 'cancelled' : 'scheduled',
      organizer: 'Teater Galeasen',
      raw: { när, status },
      external_id: `${slug}/${starts_at.slice(0, 16).replace(/[-:T]/g, '')}`,
    });
  }
  return ut;
}

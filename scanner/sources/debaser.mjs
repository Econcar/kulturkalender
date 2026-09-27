// Debaser.
//
// Webflow. Varken ld+json eller API - listsidan /events ritas i webbläsaren -
// men startsidan länkar varje kommande evenemang (/events/<slug>, 31 vid
// undersökningen 2026-09-27), och varje evenemangssida har en faktaruta:
//
//   <dt>Datum</dt><dd>Lör 31 Okt 2026</dd>
//   <dt>Tider</dt><dd>Dörrar 19.00</dd>
//   <dt>Scen</dt><dd>Debaser Strand</dd>
//   <dt>Pris</dt><dd>375 kr + serviceavgift</dd>
//
// Debaser anger ofta bara dörrtiden. Står det en scentid används den; annars
// dörrtiden, som då är det enda klockslag huset självt publicerar.
//
// Startsidan kan vara ett urval och inte hela programmet. Fler vägar in
// (sitemap, pagineringen) gav inga länkar alls.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime, parsePrices, parseSwedishDate } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://www.debaser.se';

export default {
  id: 'debaser',
  label: 'Debaser',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(`${BAS}/events/`))) throw new Error('robots.txt tillåter inte hämtning');

    const adresser = eventUrls(await hämta(`${BAS}/`));
    log(`  ${adresser.length} evenemang på startsidan`);
    if (!adresser.length) throw new Error('startsidan länkade inga evenemang - formatet kan ha ändrats');

    const ut = [];
    for (const url of adresser) {
      await paus(1200);
      try {
        const rad = toRow(await hämta(url), url);
        if (rad) ut.push(rad);
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
      }
    }
    return ut;
  },
};

export function eventUrls(html) {
  const ut = new Set();
  for (const m of String(html ?? '').matchAll(/href="\/events\/([a-z0-9-]+)"/g)) ut.add(`${BAS}/events/${m[1]}`);
  return [...ut];
}

/** Faktarutans rader som { etikett: värde }. */
export function infobox(html) {
  const ut = {};
  for (const m of String(html ?? '').matchAll(/<dt class="event-infobox__etikett">([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    const etikett = clean(m[1])?.toLowerCase();
    if (etikett) ut[etikett] = clean(m[2]);
  }
  return ut;
}

/**
 * Klockslaget ur "Tider".
 *
 * "Dörrar 19.00 Lamia Vox 19.45 King Dude 20.45": huvudaktens tid när dess
 * namn står där, annars en uttrycklig scentid, annars dörrtiden - som ofta är
 * det enda Debaser skriver.
 */
export function välj(tider, titel = '') {
  const par = [...String(tider).matchAll(/([^\d]*?)\s*(\d{1,2})[:.](\d{2})/g)]
    .map((m) => ({ namn: m[1].trim().toLowerCase(), tid: `${m[2].padStart(2, '0')}:${m[3]}` }));
  if (!par.length) return null;
  const huvud = titel.toLowerCase();
  return (par.find((p) => p.namn && huvud && (p.namn.includes(huvud) || huvud.includes(p.namn)) && !/dörr/.test(p.namn))
    ?? par.find((p) => /scen|show|start|konsert/.test(p.namn))
    ?? par.find((p) => /dörr/.test(p.namn))
    ?? par[0]).tid;
}

export function toRow(html, url) {
  const info = infobox(html);
  const dag = parseSwedishDate(info.datum);
  if (!dag) return null;

  const titel = clean(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1])
    ?? clean(/property="og:title"\s+content="([^"]*)"/.exec(html)?.[1])?.split(' | ')[0];
  if (!titel) return null;

  const tid = välj(info.tider ?? '', titel);
  const datum = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(dag));
  const starts_at = parseDateTime(tid ? `${datum}T${tid}` : datum);
  if (!starts_at) return null;

  const priser = parsePrices(info.pris ?? '');
  const bild = /property="og:image"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:image"/.exec(html);
  const biljett = /href="(https:\/\/[^"]*(?:tickster|ticketmaster|nortic|tixly|billetto)[^"]*)"/.exec(html)?.[1];

  return {
    url,
    title: titel,
    description: clean(/<meta name="description" content="([^"]*)"/.exec(html)?.[1]) ?? null,
    image_url: bild?.[1] ?? bild?.[2] ?? null,
    category: 'konsert',
    genre: null,
    venue_raw: info.scen ?? null,
    address: null,
    starts_at,
    ends_at: null,
    premiere_at: null,
    price_min: priser.length ? Math.min(...priser) : null,
    price_max: priser.length ? Math.max(...priser) : null,
    currency: 'SEK',
    ticket_url: biljett ?? null,
    status: /\binställ(t|d)\b/i.test(`${titel} ${info.datum ?? ''}`) ? 'cancelled' : 'scheduled',
    organizer: 'Debaser',
    raw: { info },
    external_id: new URL(url).pathname.split('/').pop(),
  };
}

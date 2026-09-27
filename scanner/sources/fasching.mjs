// Fasching.
//
// WordPress, där varje konsert är ett vanligt inlägg med datumet i adressen:
// /laura-misch-2026-09-27/. Inläggen listas ur /wp-json/wp/v2/posts, nyast
// publicerat först; 2 076 totalt vid undersökningen 2026-09-27, så listningen
// slutar när en hel sida bara har passerade datum. Varje konsert finns också
// på engelska under /en/, som hoppas över.
//
// Konsertsidan säger resten i klartext, utan ld+json:
//   "Datum söndag 27 september 2026 Tider På scen: 20:00 Dörrarna öppnar:
//    18:00 Scen Stora scen Pris Student: 180 KR Stående: 280 KR ..."
// Scentiden i första hand, dörrtiden om den saknas.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime, parsePrices } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://www.fasching.se';
const API = `${BAS}/wp-json/wp/v2/posts`;

export default {
  id: 'fasching',
  label: 'Fasching',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
    if (!(await robotsOk(`${BAS}/`))) throw new Error('robots.txt tillåter inte hämtning');

    const idag = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(now);
    const konserter = new Map();
    for (let sida = 1; sida <= 10; sida += 1) {
      const poster = JSON.parse(await hämta(`${API}?per_page=100&page=${sida}&orderby=date&order=desc&_fields=link,title`));
      const kommande = poster.map(post).filter((p) => p && p.datum >= idag);
      for (const p of kommande) konserter.set(p.url, p);
      if (!poster.length || !kommande.length) break;
      await paus(1000);
    }
    log(`  ${konserter.size} kommande konserter`);
    if (!konserter.size) throw new Error('inga kommande konserter bland inläggen - formatet kan ha ändrats');

    const ut = [];
    for (const p of konserter.values()) {
      await paus(1200);
      try {
        const rad = toRow(p, await hämta(p.url));
        if (rad) ut.push(rad);
      } catch (err) {
        log(`  hoppar över ${p.url}: ${err.message}`);
      }
    }
    return ut;
  },
};

/** Ett inlägg till adress, titel och datum - eller null om det inte är en svensk konsert. */
export function post(p) {
  const url = p?.link ?? '';
  if (!url.startsWith(`${BAS}/`) || url.startsWith(`${BAS}/en/`)) return null;
  const datum = /-(\d{4}-\d{2}-\d{2})\/?$/.exec(url)?.[1];
  if (!datum) return null;
  return { url, title: clean(p.title?.rendered), datum };
}

/** Konsertsidans text till en rad. */
export function toRow(p, html) {
  const text = clean(String(html ?? '').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')) ?? '';
  const tid = /På scen:\s*(\d{1,2})[:.](\d{2})/i.exec(text) ?? /Dörr(?:arna|ar)?\s*(?:öppnar)?:?\s*(\d{1,2})[:.](\d{2})/i.exec(text);
  const klocka = tid ? `${tid[1].padStart(2, '0')}:${tid[2]}` : '20:00';
  const starts_at = parseDateTime(`${p.datum}T${klocka}`);
  if (!starts_at || !p.title) return null;

  // Själva konsertdelen: från "Läs mer" till informationsrutans slut. Menyn
  // länkar "Barnkonserter" och cookierutan har knappen "Inställningar" - i
  // hela sidans text blev varenda konsert en inställd barnkonsert.
  const från = text.indexOf('Läs mer');
  const till = text.indexOf('Övrigt', Math.max(0, från));
  const innehåll = text.slice(Math.max(0, från), till > 0 ? till + 300 : undefined);

  const scen = clean(/Scen\s+(.{2,40}?)\s+Pris\b/.exec(text)?.[1]);
  const priser = parsePrices(/Pris\s+(.{0,160}?)(?:Övrigt|Åldersgräns|$)/.exec(text)?.[1] ?? '');
  const bild = /property="og:image"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:image"/.exec(String(html ?? ''));

  return {
    url: p.url,
    title: p.title,
    description: clean(/<meta name="description" content="([^"]*)"/.exec(String(html ?? ''))?.[1]) ?? null,
    image_url: bild?.[1] ?? bild?.[2] ?? null,
    category: /barnkonsert|för barn|familjekonsert/i.test(`${p.title} ${innehåll}`) ? 'barn' : 'konsert',
    genre: 'jazz',
    venue_raw: scen,
    address: null,
    starts_at,
    ends_at: null,
    premiere_at: null,
    price_min: priser.length ? Math.min(...priser) : null,
    price_max: priser.length ? Math.max(...priser) : null,
    currency: 'SEK',
    ticket_url: null,
    status: /\binställ(t|d|da|des)\b/i.test(`${p.title} ${innehåll}`) ? 'cancelled' : 'scheduled',
    organizer: 'Fasching',
    raw: { url: p.url, tid: klocka },
    external_id: new URL(p.url).pathname.replace(/^\/|\/$/g, ''),
  };
}

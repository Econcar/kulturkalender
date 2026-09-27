// Liljevalchs konsthall.
//
// WordPress med tillägget The Events Calendar, vars REST-API är öppet:
// /wp-json/tribe/events/v1/events. Utställningarna ligger där som heldagsspann
// ("Sara-Vide Ericson, DRIFT", 13 november - 28 februari), visningar och samtal
// som vanliga tider. Undersökt 2026-09-26; robots.txt stänger bara /en_poly/.
//
// Varje post finns två gånger, på svenska och engelska - de engelska har /en/
// i adressen och hoppas över.
//
// start_date i frågan ger det som slutar efter det datumet, alltså också
// pågående utställningar.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { category, parseDateTime } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://liljevalchs.se';
const API = `${BAS}/wp-json/tribe/events/v1/events`;

export default {
  id: 'liljevalchs',
  label: 'Liljevalchs konsthall',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
    if (!(await robotsOk(`${API}`))) throw new Error('robots.txt tillåter inte kalenderns API');

    const idag = now.toISOString().slice(0, 10);
    const poster = [];
    for (let sida = 1; sida <= 10; sida += 1) {
      const svar = JSON.parse(await hämta(`${API}?per_page=50&page=${sida}&start_date=${idag}`));
      poster.push(...(svar.events ?? []));
      if (sida >= (svar.total_pages ?? 1)) break;
      await paus(1000);
    }

    const rader = poster.map(toRow).filter(Boolean);
    log(`  ${poster.length} poster, ${rader.length} på svenska`);
    return rader;
  },
};

/** En post ur API:et till en rad, eller null för de engelska. */
export function toRow(e) {
  const url = e?.url ?? '';
  if (!url || new URL(url).pathname.startsWith('/en/')) return null;

  const title = clean(e.title);
  // UTC-fälten när de finns; annars är tiden lokal och tolkas som svensk.
  const starts_at = e.all_day
    ? parseDateTime(String(e.start_date ?? '').slice(0, 10))
    : parseDateTime(e.utc_start_date ? `${e.utc_start_date.replace(' ', 'T')}Z` : e.start_date);
  const ends_at = e.all_day
    ? parseDateTime(`${String(e.end_date ?? '').slice(0, 10)}T23:59`)
    : parseDateTime(e.utc_end_date ? `${e.utc_end_date.replace(' ', 'T')}Z` : e.end_date);
  if (!title || !starts_at) return null;

  const utställning = Boolean(e.all_day) && ends_at && (new Date(ends_at) - new Date(starts_at)) > 86_400_000;
  const kategorier = (e.categories ?? []).map((k) => clean(k?.name)).filter(Boolean);

  return {
    url,
    title,
    description: clean(e.excerpt) ?? null,
    image_url: e.image?.url ?? null,
    category: utställning ? 'utställning' : kategoriFör(title, kategorier),
    genre: kategorier[0] ?? null,
    venue_raw: null,
    address: null,
    starts_at,
    ends_at: ends_at && ends_at >= starts_at ? ends_at : null,
    premiere_at: null,
    price_min: null,
    price_max: null,
    currency: 'SEK',
    ticket_url: e.website || null,
    status: 'scheduled',
    organizer: 'Liljevalchs konsthall',
    raw: e,
    external_id: String(e.id),
  };
}

/**
 * Titeln först, kategorierna sedan. "Konstsamling" står på nästan allt hos
 * Liljevalchs och hade gjort varje samtal till en utställning - den räknas
 * inte.
 */
function kategoriFör(titel, kategorier) {
  for (const text of [titel, ...kategorier.filter((k) => !/konstsamling/i.test(k))]) {
    const k = category({ genre: text });
    if (k !== 'övrigt' && k !== 'utställning') return k;
  }
  return 'övrigt';
}

// Moderna Museet, Stockholm.
//
// WordPress med en egen posttyp för utställningar: /wp-json/wp/v2/exhibition.
// Datumen står i acf.dates som "20261017" och "20270314". Undersökt
// 2026-09-27; robots.txt stänger bara /wp/wp-admin/.
//
// API:et bär hela historien sedan 1990-talet - 2 433 poster - för både
// Stockholm och Malmö, på svenska och engelska, och dessutom undersidor
// (texter, biografier) som är egna poster utan datum. Urvalet görs här:
//   - lang "sv"
//   - location 12, som är Stockholm (13 är Malmö)
//   - ett slutdatum som inte passerat
// Nyast publicerade först: de aktuella utställningarna är de senast skapade,
// så några sidor räcker. Adaptern slutar när en hel sida bara har passerat.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://www.modernamuseet.se';
const API = `${BAS}/wp-json/wp/v2/exhibition`;
const FÄLT = 'id,link,title,acf,lang,location,yoast_head_json';
// Programmet - samtal, visningar, workshops - är en egen posttyp, där varje
// tillfälle står i meta._event_schedules: { start: "2026-10-04T15:00:00", end }.
const PROGRAM = `${BAS}/wp-json/wp/v2/event`;
const PROGRAMFÄLT = 'id,link,title,lang,location,meta,yoast_head_json';
const STOCKHOLM = 12;

export default {
  id: 'modernamuseet',
  label: 'Moderna Museet',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
    if (!(await robotsOk(API))) throw new Error('robots.txt tillåter inte API:et');

    const ut = [];
    for (let sida = 1; sida <= 5; sida += 1) {
      const poster = JSON.parse(await hämta(`${API}?per_page=100&page=${sida}&orderby=date&order=desc&_fields=${FÄLT}`));
      const rader = poster.map((p) => toRow(p, now)).filter(Boolean);
      ut.push(...rader);
      // En hel sida utan något aktuellt betyder att resten är arkiv.
      const daterade = poster.filter((p) => p?.acf?.dates?.end_date);
      if (!poster.length || (daterade.length && !rader.length)) break;
      await paus(1000);
    }
    log(`  ${ut.length} aktuella och kommande utställningar i Stockholm`);

    // Programmet får falla utan att utställningarna gör det.
    try {
      const program = [];
      for (let sida = 1; sida <= 3; sida += 1) {
        await paus(1000);
        const poster = JSON.parse(await hämta(`${PROGRAM}?per_page=100&page=${sida}&orderby=date&order=desc&_fields=${PROGRAMFÄLT}`));
        const rader = poster.flatMap((p) => programRader(p, now));
        program.push(...rader);
        if (!poster.length || !rader.length) break;
      }
      log(`  ${program.length} kommande programpunkter`);
      ut.push(...program);
    } catch (err) {
      log(`  programmet gick inte att hämta: ${err.message}`);
    }
    return ut;
  },
};

/** En programpost till en rad per kommande tillfälle i Stockholm. */
export function programRader(p, now = new Date()) {
  if (p?.lang !== 'sv' || !(p.location ?? []).includes(STOCKHOLM)) return [];
  const title = clean(p.title?.rendered);
  if (!title || !p.link) return [];

  return (p.meta?._event_schedules ?? [])
    .map((s) => ({ starts_at: parseDateTime(s?.start), ends_at: parseDateTime(s?.end) }))
    .filter((t) => t.starts_at && new Date(t.starts_at) >= new Date(now.getTime() - 3 * 3600_000))
    .map(({ starts_at, ends_at }) => ({
      url: p.link,
      title,
      description: clean(p.yoast_head_json?.og_description) ?? null,
      image_url: p.yoast_head_json?.og_image?.[0]?.url ?? null,
      category: programkategori(title),
      genre: null,
      venue_raw: null,
      address: null,
      starts_at,
      ends_at: ends_at && ends_at >= starts_at ? ends_at : null,
      premiere_at: null,
      price_min: null,
      price_max: null,
      currency: 'SEK',
      ticket_url: null,
      status: 'scheduled',
      organizer: 'Moderna Museet',
      raw: { id: p.id },
      external_id: `program/${p.id}/${starts_at.slice(0, 16).replace(/[-:T]/g, '')}`,
    }));
}

/** Kategori ur titeln: samtal och visningar, barn, film. Annars övrigt. */
export function programkategori(titel) {
  if (/barn|familj|krån|bebis|baby/i.test(titel)) return 'barn';
  if (/film|bio/i.test(titel)) return 'film';
  if (/konsert/i.test(titel)) return 'konsert';
  if (/samtal|föreläsning|seminarium|curatorvisning|visning/i.test(titel)) return 'föreläsning';
  return 'övrigt';
}

/** En post till en rad, eller null om den inte är en aktuell Stockholmsutställning. */
export function toRow(p, now = new Date()) {
  if (p?.lang !== 'sv') return null;
  if (!(p.location ?? []).includes(STOCKHOLM)) return null;

  const starts_at = datum(p.acf?.dates?.start_date);
  const slut = datum(p.acf?.dates?.end_date);
  if (!starts_at || !slut) return null;
  // Sista dagen hela dagen, inte vid midnatt när den börjar.
  const ends_at = new Date(new Date(slut).getTime() + 86_400_000 - 60_000).toISOString();
  if (new Date(ends_at) < now) return null;

  const title = clean(p.title?.rendered);
  if (!title) return null;

  return {
    url: p.link,
    title,
    description: clean(p.acf?.overview?.preamble) ?? clean(p.yoast_head_json?.og_description) ?? null,
    image_url: p.yoast_head_json?.og_image?.[0]?.url ?? null,
    category: 'utställning',
    genre: null,
    venue_raw: null,
    address: null,
    starts_at,
    ends_at,
    premiere_at: null,
    price_min: null,
    price_max: null,
    currency: 'SEK',
    ticket_url: null,
    status: 'scheduled',
    organizer: 'Moderna Museet',
    raw: { id: p.id, dates: p.acf?.dates },
    external_id: String(p.id),
  };
}

/** "20261017" som midnatt svensk tid. */
function datum(värde) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(värde ?? ''));
  return m ? parseDateTime(`${m[1]}-${m[2]}-${m[3]}`) : null;
}

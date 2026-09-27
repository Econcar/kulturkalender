// Dansens Hus.
//
// WordPress med en egen posttyp, /wp-json/wp/v2/dh_event, där varje
// föreställning står strukturerat i meta_box:
//
//   show_group: [{ show_datetime: "2026-11-17 19:00" }, ...]   en per kväll
//   event_startdatum / event_slutdatum, event_duration (minuter)
//   event_tickets_url, event_address (när det spelas någon annanstans)
//
// Undersökt 2026-09-27. API:et bär arkivet också - 686 poster - så listningen
// går nyast publicerat först och slutar när en hel sida bara har passerade
// kvällar. robots.txt stänger bara admin och sök.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://dansenshus.se';
const API = `${BAS}/wp-json/wp/v2/dh_event`;
const FÄLT = 'id,link,title,excerpt,meta_box,featured_media';
const MEDIA = `${BAS}/wp-json/wp/v2/media?per_page=100&_fields=id,source_url&include=`;

export default {
  id: 'dansenshus',
  label: 'Dansens Hus',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
    if (!(await robotsOk(`${BAS}/program/`))) throw new Error('robots.txt tillåter inte hämtning');

    const aktuella = [];
    for (let sida = 1; sida <= 10; sida += 1) {
      const poster = JSON.parse(await hämta(`${API}?per_page=100&page=${sida}&orderby=date&order=desc&_fields=${FÄLT}`));
      const med = poster.filter((p) => toRows(p, now).length);
      aktuella.push(...med);
      if (!poster.length || !med.length) break;
      await paus(1000);
    }

    // Bilderna i ett anrop. API:et skickar bara bildens id.
    let bilder = new Map();
    const idn = [...new Set(aktuella.map((p) => p.featured_media).filter(Boolean))];
    if (idn.length) {
      try {
        await paus(1000);
        bilder = new Map(JSON.parse(await hämta(`${MEDIA}${idn.join(',')}`)).map((b) => [b.id, b.source_url]));
      } catch (err) {
        log(`  bilderna gick inte att hämta: ${err.message}`);
      }
    }

    const ut = aktuella.flatMap((p) => toRows(p, now, bilder.get(p.featured_media)));
    log(`  ${ut.length} kommande föreställningar`);
    return ut;
  },
};

/** En föreställningspost till en rad per kommande kväll. */
export function toRows(p, now = new Date(), bild = null) {
  const m = p?.meta_box ?? {};
  const title = clean(p?.title?.rendered);
  if (!title || !p.link) return [];

  const längd = Number(m.event_duration) > 0 ? Number(m.event_duration) * 60_000 : 0;
  const annanPlats = clean(m.event_address);

  return (m.show_group ?? [])
    .map((s) => lokal(s?.show_datetime))
    .filter((t) => t && new Date(t) >= new Date(now.getTime() - 3 * 3600_000))
    .map((starts_at) => ({
      url: p.link,
      title,
      description: clean(p.excerpt?.rendered) ?? null,
      image_url: bild ?? null,
      // Dansmässan och liknande är inte föreställningar, men det är vad huset
      // gör - och en dansmässa hör hemma under dans.
      category: 'dans',
      genre: null,
      venue_raw: annanPlats,
      address: annanPlats,
      starts_at,
      // En heldag som Dansmässan (450 minuter) blir inte ett "spann" - det är
      // en dag, och speltid visas bara över ett dygn.
      ends_at: längd ? new Date(new Date(starts_at).getTime() + längd).toISOString() : null,
      premiere_at: null,
      price_min: null,
      price_max: null,
      currency: 'SEK',
      ticket_url: m.event_tickets_url || null,
      status: 'scheduled',
      organizer: 'Dansens Hus',
      raw: { id: p.id, show_group: m.show_group, startdatum: m.event_startdatum, slutdatum: m.event_slutdatum },
      external_id: `${p.id}/${starts_at.slice(0, 16).replace(/[-:T]/g, '')}`,
    }));
}

/** "2026-11-17 19:00" - lokal tid, utan zon. */
function lokal(värde) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(värde ?? ''));
  return m ? parseDateTime(`${m[1]}T${m[2]}`) : null;
}

// Vyn upcoming_events, uttryckt i JS.
//
// SQL-vyn i db/schema.sql är den som gäller i drift – den här filen är en
// lokal motsvarighet, så att `npm run dev` kan servera samma fält och samma
// urval ur en JSON-fil som Supabase gör ur Postgres. Utan den måste Supabase
// vara uppsatt innan gränssnittet går att se över huvud taget.
//
// Att de två kan glida isär är den uppenbara invändningen. Svaret är att SQL:en
// är facit och att den här bara används lokalt: en skillnad ger fel i det
// lokala läget, aldrig i drift. Fälten hålls i takt av tests/upcoming.test.mjs,
// som läser kolumnlistan ur db/schema.sql och jämför.
//
// Håll filen fri från Node-API:er.

import { VENUES } from './venues.mjs';

/** Rader som vyn skulle ha visat: kommande, inte inställda, i tidsordning. */
export function upcomingEvents(events, { venues = VENUES, now = new Date() } = {}) {
  // Huset slås upp på källans id, precis som vyns join v.slug = e.source.
  const hus = new Map(venues.map((v) => [v.slug, v]));

  return (events ?? [])
    .filter((e) => e && e.status !== 'cancelled')
    // "Pågående räknas som kommande" – samma tre timmar som i SQL-vyn, så att
    // en konsert som började för en timme sedan inte försvinner ur listan.
    .filter((e) => new Date(e.starts_at).getTime() >= now.getTime() - 3 * 3600_000)
    .map((e) => toViewRow(e, hus.get(e.source), now))
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
}

/**
 * En rad i tabellform till en rad i vyform.
 *
 * venue är huset och stage är rummet i det. Båda kallas "scen" på svenska,
 * vilket är precis därför de har olika namn här.
 */
export function toViewRow(e, venue, now = new Date()) {
  return {
    id: e.id ?? `${e.source}|${e.external_id}`,
    source: e.source,
    url: e.url,
    title: e.title,
    description: e.description,
    image_url: e.image_url,
    category: e.category,
    genre: e.genre,
    venue: venue?.name ?? e.organizer ?? e.source,
    venue_slug: venue?.slug ?? null,
    stage: e.venue_raw ?? null,
    address: venue?.address ?? e.address,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    price_min: e.price_min,
    price_max: e.price_max,
    currency: e.currency,
    ticket_url: e.ticket_url,
    status: e.status,
    last_seen_at: e.last_seen_at,
    days_until: Math.trunc((new Date(e.starts_at).getTime() - now.getTime()) / 86_400_000),
  };
}

/**
 * Husen med hur mycket som är på gång – motsvarar vyn venue_summary.
 *
 * Alla registrerade hus kommer med, även de med noll. Ett hus vars adapter
 * gått sönder ska synas med en nolla och inte försvinna ur listan: att tappa
 * Dramaten helt vore ett tystare fel än att visa "Dramaten 0".
 */
export function venueSummary(rader, { venues = VENUES } = {}) {
  const antal = new Map(venues.map((v) => [v.slug, 0]));
  const nästa = new Map();
  const hämtat = new Map();

  for (const r of rader ?? []) {
    if (!antal.has(r.source)) continue;
    antal.set(r.source, antal.get(r.source) + 1);
    if (!nästa.has(r.source) || r.starts_at < nästa.get(r.source)) {
      nästa.set(r.source, r.starts_at);
    }
    if (r.last_seen_at && (!hämtat.has(r.source) || r.last_seen_at > hämtat.get(r.source))) {
      hämtat.set(r.source, r.last_seen_at);
    }
  }

  return venues.map((v) => ({
    slug: v.slug,
    name: v.name,
    url: v.url,
    upcoming_count: antal.get(v.slug) ?? 0,
    next_at: nästa.get(v.slug) ?? null,
    // Motsvarar max(e.last_seen_at) i vyn. Null när huset inte har någon rad:
    // "vi vet inte när det hämtades" är inte samma sak som "det hämtades aldrig",
    // men det är det ärligaste vi kan säga om ett hus utan evenemang.
    last_scan_at: hämtat.get(v.slug) ?? null,
  }));
}

/**
 * Filtren från /api/events, tillämpade i JS.
 *
 * Motsvarar PostgREST-frågan i functions/api/events.js. Sökningen träffar
 * titel, beskrivning och scen, precis som or-uttrycket där.
 */
export function applyFilters(rader, { category, venue, from, to, q, limit = 60, offset = 0 } = {}) {
  let ut = rader;

  if (category) ut = ut.filter((r) => r.category === category);
  if (venue) ut = ut.filter((r) => r.venue_slug === venue);
  if (from) ut = ut.filter((r) => r.starts_at >= `${from}T00:00:00Z`);
  if (to) ut = ut.filter((r) => r.starts_at <= `${to}T23:59:59Z`);

  if (q && q.length >= 2) {
    const nål = q.toLowerCase();
    ut = ut.filter((r) => `${r.title ?? ''} ${r.description ?? ''} ${r.venue ?? ''} ${r.stage ?? ''}`
      .toLowerCase()
      .includes(nål));
  }

  return ut.slice(offset, offset + limit);
}

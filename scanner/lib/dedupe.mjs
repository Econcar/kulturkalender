// Dubblettfilter. Samma evenemang dyker upp flera gånger – dels inom en källa
// (en uppsättning listas på både program- och kalendersidan), dels mellan
// källor (scenens egen sida och biljettförsäljarens).

/** Nyckel inom en källa: källans egna id är auktoritativt. */
export function sourceKey(event) {
  return `${event.source}|${event.external_id}`;
}

/**
 * Nyckel på evenemangsnivå: samma titel, samma scen, samma starttid är samma
 * evenemang oavsett var det annonseras.
 *
 * Starttiden jämförs på minuten, inte på sekunden. Källor avrundar olika, och
 * "19:00:00" och "19:00" ska inte bli två rader i listan.
 */
export function eventKey(event) {
  return [
    normalizeTitle(event.title),
    normalizeTitle(event.venue_raw),
    String(event.starts_at ?? '').slice(0, 16),
  ].join('|');
}

/**
 * Titlar jämförs nedbantade: gemener, ihopdragna blanksteg, och utan den
 * svans scener gärna hänger på ("Misantropen – Stora scenen", "Misantropen").
 */
export function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[–—-]\s*[^–—-]*$/, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tar bort dubbletter i en batch från en och samma källa.
 * Vid krock vinner den mest kompletta raden – ett halvparsat duplikat ska
 * aldrig skriva över en rad med fler ifyllda fält.
 */
export function dedupeBatch(events) {
  const byKey = new Map();
  for (const event of events ?? []) {
    if (!event?.external_id) continue;
    const key = sourceKey(event);
    const existing = byKey.get(key);
    if (!existing || completeness(event) > completeness(existing)) byKey.set(key, event);
  }
  return [...byKey.values()];
}

/**
 * Grupperar samma evenemang över källor. Returnerar en Map eventKey → rader,
 * så att listan kan visa ett evenemang en gång med flera biljettlänkar i
 * stället för samma konsert tre gånger.
 */
export function groupDuplicates(events) {
  const groups = new Map();
  for (const event of events ?? []) {
    const key = eventKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return groups;
}

const SCORED_FIELDS = [
  'title', 'description', 'image_url', 'category',
  'venue_raw', 'address', 'starts_at', 'ends_at',
  'price_min', 'ticket_url', 'organizer',
];

/** Antal ifyllda fält – proxy för hur användbar raden är. */
export function completeness(event) {
  return SCORED_FIELDS.reduce(
    (sum, field) => sum + (event?.[field] === null || event?.[field] === undefined || event?.[field] === '' ? 0 : 1),
    0,
  );
}

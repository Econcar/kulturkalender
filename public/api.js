// Samtalet med /api/events. Ligger skilt från app.js för att det ska gå att
// testa – app.js rör document redan vid import och kan inte laddas av
// node --test.

/** Frågesträngen till /api/events. Tomma filter utelämnas helt. */
export function buildQuery({ category = '', venue = '', q = '', from = '', to = '', offset = 0, limit = 60 } = {}) {
  const p = new URLSearchParams({ limit: String(limit) });
  if (category) p.set('category', category);
  if (venue) p.set('venue', venue);
  if (q) p.set('q', q);
  // Datumen skickas som de är. Formen bevakas i functions/api/events.js, som
  // tyst släpper det som inte ser ut som ett datum – filtret ska inte kunna
  // bli en väg in i frågan.
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (offset) p.set('offset', String(offset));
  return p.toString();
}

/**
 * Läser svaret och kastar med ett begripligt fel när det inte är det vi bad om.
 *
 * Kontrollen av content-type finns för ett verkligt läge: Cloudflare Pages
 * faller tillbaka på index.html för sökvägar den inte känner igen. Är Functionen
 * inte utrullad svarar /api/events alltså 200 med en HTML-sida, och res.json()
 * kastar "Unexpected token '<'" – ett felmeddelande som pekar åt fel håll och
 * kostar en kväll att förstå. Hellre säga vad som faktiskt är fel.
 */
export async function parseResponse(res, { nyckel = 'events' } = {}) {
  if (!res.ok) {
    throw new Error(`servern svarade ${res.status}`);
  }

  const typ = res.headers?.get?.('content-type') ?? '';
  if (!typ.includes('json')) {
    throw new Error('API:et svarade HTML i stället för JSON – är Pages Function utrullad?');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('API:et svarade trasig JSON');
  }

  if (!data || !Array.isArray(data[nyckel])) {
    throw new Error(`svaret saknade en ${nyckel}-lista`);
  }
  return data;
}

/** Hämtar och läser i ett svep. fetchImpl finns för testernas skull. */
export async function fetchEvents(state, { limit = 60, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`/api/events?${buildQuery({ ...state, limit })}`);
  return parseResponse(res);
}

/**
 * Husen sidan hämtar från.
 *
 * Faller listan bort ska sidan fungera ändå – den är en upplysning, inte en
 * förutsättning för att läsa evenemangen. Därför tom lista i stället för att
 * kasta vidare.
 */
export async function fetchVenues({ fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl('/api/venues');
    const data = await parseResponse(res, { nyckel: 'venues' });
    return data.venues;
  } catch {
    return [];
  }
}

/**
 * Uppsättningarna hos scenerna - en rad per pjäs, inte per kväll.
 *
 * Egen funktion och inte en flagga till fetchEvents: svaret har en annan form
 * (productions, inte events) och en annan mening. Ett filter som råkar skickas
 * till fel endpoint ska inte tyst ge ett svar som ser rimligt ut.
 */
export async function fetchProductions(state, { limit = 100, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`/api/productions?${buildQuery({ ...state, limit })}`);
  return parseResponse(res, { nyckel: 'productions' });
}

/**
 * Nyheterna: nya uppsättningar och nya recensioner.
 *
 * Tar inga filter - en enda cachenyckel räcker, och scen och kategori läggs
 * på i webbläsaren.
 */
export async function fetchNews({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl('/api/news');
  return parseResponse(res, { nyckel: 'productions' });
}

/**
 * Alla sparade recensioner, för korten.
 *
 * Som husen: faller listan bort visas korten utan recensioner i stället för
 * att sidan slutar fungera.
 */
export async function fetchReviews({ fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl('/api/reviews');
    const data = await parseResponse(res, { nyckel: 'reviews' });
    return data.reviews;
  } catch {
    return [];
  }
}

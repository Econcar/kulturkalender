// Samtalet med /api/events. Ligger skilt från app.js för att det ska gå att
// testa – app.js rör document redan vid import och kan inte laddas av
// node --test.

/** Frågesträngen till /api/events. Tomma filter utelämnas helt. */
export function buildQuery({ category = '', q = '', offset = 0, limit = 60 } = {}) {
  const p = new URLSearchParams({ limit: String(limit) });
  if (category) p.set('category', category);
  if (q) p.set('q', q);
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
export async function parseResponse(res) {
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

  if (!data || !Array.isArray(data.events)) {
    throw new Error('svaret saknade en events-lista');
  }
  return data;
}

/** Hämtar och läser i ett svep. fetchImpl finns för testernas skull. */
export async function fetchEvents(state, { limit = 60, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`/api/events?${buildQuery({ ...state, limit })}`);
  return parseResponse(res);
}

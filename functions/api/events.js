import { clampInt, fail, json, options, supabaseRest } from './_shared.js';

// Vitlistor. Allt som sätts in i PostgREST-frågan måste komma härifrån och
// aldrig rakt från klienten – strängarna blir en del av frågan, inte parametrar
// till den.
const CATEGORIES = new Set([
  'konsert', 'teater', 'opera', 'dans', 'utställning', 'film',
  'barn', 'föreläsning', 'litteratur', 'humor', 'festival', 'övrigt',
]);

export const onRequestOptions = options;

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;

  const query = new URLSearchParams({
    select: '*',
    // En kalender har en självklar ordning. Det finns inget att välja på.
    order: 'starts_at.asc',
    limit: String(clampInt(params.get('limit'), { min: 1, max: 200, fallback: 60 })),
  });

  const offset = clampInt(params.get('offset'), { min: 0, max: 10000, fallback: 0 });
  if (offset) query.append('offset', String(offset));

  const category = (params.get('category') || '').trim().toLowerCase();
  if (CATEGORIES.has(category)) query.append('category', `eq.${category}`);

  // Scenen pekas ut med slug, inte med namn: slugen är validerad i schemat
  // (^[a-z0-9-]+$) och kan därför inte bära något som ändrar frågan.
  const venue = (params.get('venue') || '').trim().toLowerCase();
  if (/^[a-z0-9-]{1,60}$/.test(venue)) query.append('venue_slug', `eq.${venue}`);

  // Datumen släpps bara igenom på exakt formen ÅÅÅÅ-MM-DD.
  const from = (params.get('from') || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query.append('starts_at', `gte.${from}T00:00:00Z`);

  const to = (params.get('to') || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query.append('starts_at', `lte.${to}T23:59:59Z`);

  const term = searchTerm(params.get('q'));
  if (term) query.append('or', `(title.ilike.*${term}*,description.ilike.*${term}*,venue.ilike.*${term}*)`);

  try {
    const events = await supabaseRest(env, `upcoming_events?${query}`);
    return json({ generated_at: new Date().toISOString(), count: events.length, events });
  } catch (err) {
    return fail(err.message, 502);
  }
}

/**
 * Sökordet städat för PostgREST.
 *
 * Komma, parentes, punkt, asterisk och citattecken är syntax i or-uttrycket
 * ovan. Ett sökord som innehåller dem skulle inte bara ge fel träffar utan
 * ändra frågans form. De tas bort i stället för att escapas – en sökruta för
 * evenemangstitlar behöver dem inte, och borttagning har inga hörnfall.
 */
function searchTerm(value) {
  const rensad = String(value ?? '')
    .replace(/[(),.*"'\\%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return rensad.length >= 2 ? rensad.slice(0, 60) : null;
}

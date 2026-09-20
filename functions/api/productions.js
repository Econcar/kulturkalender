import { clampInt, fail, json, options, supabaseRest } from './_shared.js';

// Uppsättningarna, en rad per pjäs eller konsert i stället för en per kväll.
// Svarar på "vad spelar Dramaten?" - en annan fråga än "vad händer i kväll?",
// som /api/events svarar på.
//
// Samma vitlistning som events.js: allt som sätts in i PostgREST-frågan kommer
// härifrån och aldrig rakt från klienten.

const CATEGORIES = new Set([
  'konsert', 'teater', 'opera', 'dans', 'utställning', 'film',
  'barn', 'föreläsning', 'litteratur', 'humor', 'cirkus', 'festival', 'övrigt',
]);

export const onRequestOptions = options;

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;

  const query = new URLSearchParams({
    select: '*',
    // Premiärdatum är den ordning en repertoar läses i: det som börjar snart
    // först. Inte antal föreställningar - då hamnar hela höstens program före
    // det som spelas i morgon.
    order: 'first_at.asc',
    limit: String(clampInt(params.get('limit'), { min: 1, max: 300, fallback: 100 })),
  });

  const offset = clampInt(params.get('offset'), { min: 0, max: 10000, fallback: 0 });
  if (offset) query.append('offset', String(offset));

  const venue = (params.get('venue') || '').trim().toLowerCase();
  if (/^[a-z0-9-]{1,60}$/.test(venue)) query.append('venue_slug', `eq.${venue}`);

  const category = (params.get('category') || '').trim().toLowerCase();
  if (CATEGORIES.has(category)) query.append('category', `eq.${category}`);

  // Sökningen täcker titeln och beskrivningen. Rummet finns inte här: en
  // uppsättning kan spelas i flera, och vyn räknar dem i stället för att
  // namnge dem.
  const term = searchTerm(params.get('q'));
  if (term) {
    query.append('or', `(title.ilike.*${term}*,description.ilike.*${term}*,venue.ilike.*${term}*)`);
  }

  try {
    const productions = await supabaseRest(env, `upcoming_productions?${query}`);
    return json({ generated_at: new Date().toISOString(), count: productions.length, productions });
  } catch (err) {
    return fail(err.message, 502);
  }
}

/** Sökordet städat för PostgREST. Samma resonemang som i events.js. */
function searchTerm(value) {
  const rensad = String(value ?? '')
    .replace(/[(),.*"'\\%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return rensad.length >= 2 ? rensad.slice(0, 60) : null;
}

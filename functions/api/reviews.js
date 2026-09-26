import { fail, json, options, supabaseRest } from './_shared.js';
import { reviewForPage } from '../../lib/review-match.mjs';

// Alla sparade recensioner, för korten och för recensionsvyn. Sidan hämtar
// listan en gång och slår upp varje uppsättning i den - tabellen är liten (en
// handfull i månaden), och en fråga per kort hade varit hundra anrop för att
// hitta en recension.
//
// Uppsättningarna läses med för länken till scenens sida och husets namn. En
// pjäs som spelat klart finns inte där, och då räcker ögonblicksbilden i
// raden.
//
// Samlas in av scanner/reviews/run.mjs. Se avsnitt 7b i docs/projektstart.md.

const CACHE_SEKUNDER = 1800;

export const onRequestOptions = options;

export async function onRequestGet({ env }) {
  try {
    const [rader, uppsättningar] = await Promise.all([
      supabaseRest(env, 'reviews?select=*&order=published_at.desc.nullslast&limit=1000'),
      supabaseRest(env, 'upcoming_productions?select=production_key,title,venue,venue_slug,category,url&limit=1000'),
    ]);
    const reviews = rader.map((r) => reviewForPage(r, uppsättningar));
    return json({ generated_at: new Date().toISOString(), count: reviews.length, reviews }, { maxAge: CACHE_SEKUNDER });
  } catch (err) {
    return fail(err.message, 502);
  }
}

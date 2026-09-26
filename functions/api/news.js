import { fail, json, options, supabaseRest } from './_shared.js';
import { reviewForPage } from '../../lib/review-match.mjs';

// Nyhetssidan: vad som är nytt hos scenerna, och vad som skrivits om det.
//
// Två slags nyheter, båda ur vår egen data.
//
// Nya uppsättningar: skannern sätter first_seen_at en gång per rad och rör den
// aldrig mer, så en uppsättning vars tidigaste rad dök upp i går är en
// uppsättning scenen annonserade i går. Inga pressmeddelanden att tolka.
//
// Recensionerna: ur reviews-tabellen, som scanner/reviews/run.mjs fyller varje
// natt. De matchades först här, mot flödena vid varje förfrågan - men flödena
// glömmer inom en vecka, och då försvann recensionen från sidan.
//
// Ändpunkten tar inga parametrar. Filtren görs i webbläsaren, och en enda
// cachenyckel räcker.

const CACHE_SEKUNDER = 1800;

// Hur långt bakåt något räknas som nytt. Två veckor är vad en människa menar
// med "har det kommit något nytt?", och det täcker en utebliven nattkörning.
const NYTT_DYGN = 14;

export const onRequestOptions = options;

export async function onRequestGet({ env }) {
  let uppsättningar;
  try {
    // Alla, inte bara de nya: recensionerna slås upp i hela repertoaren.
    uppsättningar = await supabaseRest(env, 'upcoming_productions?select=*&limit=1000');
  } catch (err) {
    return fail(err.message, 502);
  }

  const gräns = Date.now() - NYTT_DYGN * 86_400_000;
  const nya = uppsättningar
    .filter((p) => p.announced_at && new Date(p.announced_at).getTime() >= gräns)
    .sort((a, b) => String(b.announced_at).localeCompare(String(a.announced_at)))
    .slice(0, 40);

  // Recensionerna får falla utan att fälla nyheterna. Saknas tabellen ännu är
  // det inget skäl att dölja att Dramaten satt upp något nytt.
  let recensioner = [];
  try {
    recensioner = await hämtaRecensioner(env, uppsättningar);
  } catch {
    recensioner = [];
  }

  return json({
    generated_at: new Date().toISOString(),
    days: NYTT_DYGN,
    productions: nya,
    reviews: recensioner,
  }, { maxAge: CACHE_SEKUNDER });
}

/**
 * Recensionerna från de senaste NYTT_DYGN dygnen, ur reviews-tabellen.
 *
 * Uppsättningarna skickas med för husets namn och kategorin, som filtren i
 * nyhetsvyn läser.
 */
async function hämtaRecensioner(env, uppsättningar) {
  const gräns = new Date(Date.now() - NYTT_DYGN * 86_400_000).toISOString();
  const rader = await supabaseRest(
    env,
    `reviews?select=*&published_at=gte.${gräns}&order=published_at.desc&limit=100`,
  );
  return rader.map((r) => reviewForPage(r, uppsättningar));
}

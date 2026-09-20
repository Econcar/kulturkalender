// Kopplar en recension till en uppsättning.
//
// Hela funktionens värde ligger här, och hela risken också. En recension som
// hängs på fel pjäs är sämre än ingen recension: den missinformerar besökaren,
// och den är orättvis mot både uppsättningen och kritikern. Regeln är därför
// medvetet snäv, och det som inte matchar ska sparas omatchat i stället för att
// gissas fram.
//
// Undersökningen som gav regeln, gjord 2026-09-20 på riktiga flöden:
//
// Rubrikerna är värdelösa. Kulturjournalistik skriver "Vid Ibsens polisonger –
// sanning är något extremt". Ingen rubrik säger vad som recenseras eller ens
// att det är en recension.
//
// Adressen bär däremot allt:
//
//   aftonbladet.se/kultur/teater/a/M7Gv7B/recension-parzival-av-lukas-barfuss-pa-dramaten
//                        ↑                 ↑          ↑                        ↑
//                     sektion          "recension"  uppsättningen           huset
//
// Sex av sex teaterrecensioner hos Aftonbladet och tre av fyra hos SvD bar
// huset i slugen. Kravet på husmatchning är alltså realistiskt - och det är
// kravet som gör regeln användbar, för flödena är fulla av Malmö, Göteborg,
// Uppsala, Norrköping och Köpenhamn. "Romeo och Julia på Östgötateatern" får
// inte hamna på en Stockholmsuppsättning av samma pjäs.
//
// Håll filen fri från Node-API:er. Den körs av node --test och av skannern.

import { VENUES } from './venues.mjs';

/** Ord i slugen som betyder att artikeln är en recension. */
const RECENSIONSORD = ['recension', 'recensioner', 'kritik'];

/**
 * Sektioner som säkert inte handlar om scenkonst.
 *
 * En denylist och inte en allowlist: SvD har ingen sektion i adressen alls, så
 * en allowlist hade uteslutit dem helt. Listan tar bara bort det som är
 * otvetydigt - bokrecensioner handlar om böcker, inte om kvällar man kan gå på.
 */
const UTESLUTNA_SEKTIONER = new Set(['bokrecensioner', 'bokrecension']);

/**
 * Husens namn som en tidning kan skriva dem.
 *
 * Slugen bär huset som tidningen kallar det, inte som vi gör. Aliasen står här
 * och inte i lib/venues.mjs, eftersom de bara betyder något för matchningen -
 * flyttar de nytta sig någon annanstans hör de dit i stället.
 */
export const HUSALIAS = {
  dramaten: ['dramaten', 'kungliga-dramatiska-teatern', 'dramatiska-teatern'],
  kulturhuset: ['kulturhuset', 'kulturhuset-stadsteatern', 'stadsteatern', 'stockholms-stadsteater'],
  konserthuset: ['konserthuset', 'stockholms-konserthus', 'konserthuset-stockholm'],
  operan: ['operan', 'kungliga-operan', 'operahuset'],
};

/**
 * Text till slug: "Gengångare" blir "gengangare".
 *
 * Måste ge samma resultat som tidningarnas egna slugar, annars matchar
 * ingenting. De skriver å och ä som a, ö som o.
 */
export function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[àáâã]/g, 'a')
    .replace(/[åä]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ýÿ]/g, 'y')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Läser vad adressen säger om artikeln.
 *
 * Returnerar slugen, sektionerna och om det är en recension. Kastar inte på en
 * trasig adress - en post i ett flöde får vara skräp utan att fälla svepet.
 */
export function parseReviewUrl(url) {
  let sökväg;
  let värd;
  try {
    const u = new URL(String(url));
    sökväg = u.pathname;
    värd = u.hostname.replace(/^www\./, '');
  } catch {
    return { isReview: false, slug: '', segments: [], host: null };
  }

  const segments = sökväg.split('/').filter(Boolean).map((s) => s.toLowerCase());
  const slug = segments.at(-1) ?? '';
  const ord = new Set(slug.split('-'));

  return {
    isReview: RECENSIONSORD.some((r) => ord.has(r)),
    slug,
    segments,
    host: värd,
  };
}

/**
 * Om en slug innehåller en annan som hela ord.
 *
 * Ordgränserna är nödvändiga. Uppsättningen "Fejk" skulle annars matcha
 * "recension-fejkade-kvitton-...", och våra titlar är korta och generiska -
 * Fejk, Vilse, Glow up.
 */
export function slugContains(slug, nål) {
  if (!slug || !nål) return false;
  const ord = String(slug).split('-');
  const sökt = String(nål).split('-');
  if (!sökt.length || sökt.some((s) => !s)) return false;

  for (let i = 0; i + sökt.length <= ord.length; i += 1) {
    if (sökt.every((s, j) => ord[i + j] === s)) return true;
  }
  return false;
}

/**
 * Uppsättningen en recension handlar om, eller null.
 *
 * Kräver att BÅDE titeln och huset finns i slugen. Bara titel räcker inte -
 * se resonemanget högst upp om Östgötateatern.
 *
 * Tiden prövas när vi vet premiären: en recension kommer inom ett par veckor
 * efter premiär, och en artikel från i våras handlar om en annan uppsättning
 * även om titeln stämmer. Saknas premiärdatum - Konserthuset och Operan ger
 * inget - krävs i stället att recensionen är publicerad innan sista
 * föreställningen, vilket är en svagare men rimlig gräns.
 *
 * Returnerar aldrig en gissning mellan två lika bra kandidater. Två träffar
 * betyder att regeln inte kan avgöra, och då är null det sanna svaret.
 */
export function matchReview(review, productions, { dagar = 21, alias = HUSALIAS } = {}) {
  const adress = parseReviewUrl(review?.url);
  if (!adress.isReview) return null;
  if (adress.segments.some((s) => UTESLUTNA_SEKTIONER.has(s))) return null;

  const publicerad = review?.published ? new Date(review.published) : null;
  const giltigTid = publicerad && !Number.isNaN(publicerad.getTime()) ? publicerad : null;

  const kandidater = [];
  for (const p of productions ?? []) {
    const titel = slugify(p?.title);
    if (!slugContains(adress.slug, titel)) continue;

    const husalias = alias[p?.venue_slug] ?? [slugify(p?.venue)];
    const husträff = husalias.find((namn) => slugContains(adress.slug, namn));
    if (!husträff) continue;

    const tid = tidsomdöme(p, giltigTid, dagar);
    if (tid === 'utanför') continue;

    kandidater.push({
      production_key: p.production_key,
      confidence: tid === 'inom' ? 'hög' : 'osäker',
      // Vad som avgjorde. Sparas för att en matchning ska gå att ifrågasätta
      // i efterhand utan att man behöver köra om något.
      matched_title: titel,
      matched_venue: husträff,
    });
  }

  if (kandidater.length !== 1) return null;
  return kandidater[0];
}

/**
 * Om recensionens datum passar uppsättningen: 'inom', 'okänt' eller 'utanför'.
 */
function tidsomdöme(p, publicerad, dagar) {
  if (!publicerad) return 'okänt';

  if (p?.premiere_at) {
    const premiär = new Date(p.premiere_at).getTime();
    if (!Number.isNaN(premiär)) {
      const dygn = Math.abs(publicerad.getTime() - premiär) / 86_400_000;
      return dygn <= dagar ? 'inom' : 'utanför';
    }
  }

  // Utan premiärdatum: recensionen får inte vara publicerad efter att
  // uppsättningen slutat spelas.
  const sista = p?.last_at ? new Date(p.last_at).getTime() : NaN;
  if (!Number.isNaN(sista) && publicerad.getTime() > sista) return 'utanför';
  return 'okänt';
}

/** Alla registrerade hus har ett alias. Vaktas av tests/review-match.test.mjs. */
export function husUtanAlias(venues = VENUES) {
  return venues.filter((v) => !HUSALIAS[v.slug]).map((v) => v.slug);
}

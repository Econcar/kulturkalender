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

import { publicistNamn } from './feeds.mjs';
import { rensaSpårning } from './rss.mjs';
import { VENUES, venueBySlug } from './venues.mjs';

/** Ord i slugen som betyder att artikeln är en recension. */
const RECENSIONSORD = ['recension', 'recensionen', 'recensioner', 'kritik'];

/** Hur länge efter sista föreställningen en recension fortfarande hör till den. */
const EFTERÅT_DYGN = 10;

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
  // Kägelbanan är Södra Teaterns andra scen och skrivs ofta ensam.
  sodrateatern: ['sodra-teatern', 'sodrateatern', 'kagelbanan'],
  folkoperan: ['folkoperan'],
  // Inte "china" eller "oscars" ensamma: de förekommer i helt andra artiklar,
  // och huset är halva matchningen.
  chinateatern: ['china-teatern', 'chinateatern'],
  oscarsteatern: ['oscarsteatern'],
  intiman: ['intiman'],
  gotalejon: ['gota-lejon', 'gotalejon'],
  giljotin: ['teater-giljotin', 'giljotin'],
  strindbergs: ['strindbergs-intima-teater', 'strindbergs-intima', 'intima-teatern'],
  liljevalchs: ['liljevalchs', 'liljevalchs-konsthall'],
  modernamuseet: ['moderna-museet', 'modernamuseet'],
  fotografiska: ['fotografiska'],
  nationalmuseum: ['nationalmuseum'],
  nalen: ['nalen'],
  // Arenorna har bytt namn, och tidningarna skriver ofta det gamla.
  aviciiarena: ['avicii-arena', 'globen', 'ericsson-globen'],
  annexet: ['annexet'],
  hovet: ['hovet'],
  treaarena: ['3arena', 'tele2-arena'],
  strawberryarena: ['strawberry-arena', 'friends-arena'],
  berwaldhallen: ['berwaldhallen'],
  fasching: ['fasching'],
  debaser: ['debaser', 'debaser-strand'],
  dansenshus: ['dansens-hus', 'dansenshus'],
  artipelag: ['artipelag'],
  konstakademien: ['konstakademien'],
  zita: ['zita', 'zita-folkets-bio'],
  biorio: ['bio-rio', 'biorio'],
  cinemateket: ['cinemateket', 'filmhuset'],
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
    // Övriga accenter: Iñárritu, Kieślowski, Ceylan. Tabellen nedan står kvar
    // för läsbarheten och för tecknen som inte delas upp (ø, æ, ß).
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
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
  return ordContains(String(slug).split('-'), nål);
}

/**
 * Samma jämförelse, men mot en redan delad slug.
 *
 * Finns för att matchningen körs i en Cloudflare Worker, där CPU-tiden är
 * knapp. Att dela om recensionens slug för varje uppsättning gav tjugotusen
 * onödiga delningar per sidladdning.
 */
export function ordContains(ord, nål) {
  if (!ord?.length || !nål) return false;
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

  // Huset avgörs först, en gång för hela recensionen.
  //
  // Den naiva ordningen - pröva varje uppsättning mot varje alias - kostade 24
  // millisekunder per sidladdning mot 337 uppsättningar, vilket är för mycket
  // för en Worker. En recension nämner som mest ett av våra fyra hus, så tolv
  // jämförelser räcker för att veta vilket. Sedan behöver bara det husets
  // uppsättningar slugifieras. Mätt: 24 ms blev under en.
  const ord = adress.slug.split('-');
  const husträff = Object.entries(alias)
    .map(([slug, namn]) => [slug, namn.find((n) => ordContains(ord, n))])
    .find(([, träff]) => träff);
  if (!husträff) return null;

  const [husSlug, husNamn] = husträff;

  const kandidater = [];
  for (const p of productions ?? []) {
    if (p?.venue_slug !== husSlug) continue;

    const titel = slugify(p?.title);
    if (!ordContains(ord, titel)) continue;

    const tid = tidsomdöme(p, giltigTid, dagar);
    if (tid === 'utanför') continue;

    kandidater.push({
      production_key: p.production_key,
      confidence: tid === 'inom' ? 'hög' : 'osäker',
      // Vad som avgjorde. Sparas för att en matchning ska gå att ifrågasätta
      // i efterhand utan att man behöver köra om något.
      matched_title: titel,
      matched_venue: husNamn,
    });
  }

  if (kandidater.length !== 1) return null;
  return kandidater[0];
}

/** Biograferna. En film är densamma på alla, så huset säger inget om den. */
const FILMHUS = new Set(VENUES.filter((v) => v.typ === 'film').map((v) => v.slug));

/** Hur långt före första visningen hos oss en filmrecension får vara skriven. */
const FILM_FÖRE_DYGN = 60;

/** "film|fjord": filmen oberoende av biograf. */
export function filmnyckel(titel) {
  const s = slugify(titel);
  return s ? `film|${s}` : null;
}

/**
 * Filmen en recension handlar om, eller null.
 *
 * Husregeln i matchReview fungerar inte för film: recensionen skrivs om
 * filmen, inte om biografen, och adressen nämner aldrig Bio Rio eller Zita -
 * "nojesbladet/film/a/…/stormen-recension-bornebuschs-nya-film-ar…". Kravet
 * på hus byts därför mot tre andra:
 *
 *   - adressen ligger i en filmsektion, så att en teaterrecension av
 *     Shakespeares Stormen aldrig blir en filmrecension
 *   - titeln står först i slugen eller direkt efter "recension", inte
 *     någonstans i mitten - våra filmtitlar är korta ord som Fjord och
 *     Stormen, och de förekommer i andra meningar
 *   - recensionen är skriven inom två månader före första visningen hos oss
 *     och senast tio dygn efter den sista. Filmerna saknar premiärdatum, och
 *     en film som gått i fem veckor har sin första kommande visning i dag.
 *
 * Träffen är filmen, inte en visning: production_key blir filmnyckeln, och
 * sidan hänger recensionen på varje biograf som visar filmen. Två olika filmer
 * som båda passar ger null, som i matchReview - utom när den ena titeln är
 * längre och innehåller den andra, för då är den längre det som står där.
 */
export function matchFilmReview(review, productions, { före = FILM_FÖRE_DYGN, filmhus = FILMHUS } = {}) {
  const adress = parseReviewUrl(review?.url);
  if (!adress.isReview) return null;
  if (adress.segments.some((s) => UTESLUTNA_SEKTIONER.has(s))) return null;
  // Utan filmsektion - SVT har ingen - duger regissörens efternamn i stället:
  // "svt.se/kultur/recension-digger-av-alejandro-gonzalez-inarritu".
  const filmsektion = adress.segments.slice(0, -1).includes('film');

  const ord = adress.slug.split('-');
  const publicerad = new Date(review?.published ?? '');
  const tid = Number.isNaN(publicerad.getTime()) ? null : publicerad.getTime();

  const filmer = new Map();
  for (const p of productions ?? []) {
    if (!filmhus.has(p?.venue_slug)) continue;
    const titel = slugify(p?.title);
    if (titel.replace(/-/g, '').length < 3) continue;
    if (!titelnFörst(ord, titel.split('-'))) continue;
    if (!filmsektion && !regissörISlugen(ord, p.description)) continue;

    if (tid !== null) {
      const första = new Date(p.first_at ?? '').getTime();
      const sista = new Date(p.last_at ?? '').getTime();
      if (!Number.isNaN(första) && tid < första - före * 86_400_000) continue;
      if (!Number.isNaN(sista) && tid > sista + EFTERÅT_DYGN * 86_400_000) continue;
    }

    const nyckel = `film|${titel}`;
    if (!filmer.has(nyckel)) filmer.set(nyckel, { titel, uppsättningar: [] });
    filmer.get(nyckel).uppsättningar.push(p);
  }

  const längst = [...filmer.entries()]
    .sort(([, a], [, b]) => b.titel.length - a.titel.length);
  if (!längst.length) return null;
  if (längst.length > 1 && längst[1][1].titel.length === längst[0][1].titel.length) return null;

  const [nyckel, { titel, uppsättningar }] = längst[0];
  return {
    production_key: nyckel,
    production_title: uppsättningar[0].title,
    category: 'film',
    confidence: 'osäker',
    matched_title: titel,
    matched_venue: null,
    matched_by: 'film',
  };
}

/** Titeln först i slugen, eller direkt efter ett recensionsord. */
function titelnFörst(ord, titel) {
  const på = (i) => titel.every((t, j) => ord[i + j] === t);
  if (på(0)) return true;
  for (let i = 0; i < ord.length; i += 1) {
    if (RECENSIONSORD.includes(ord[i]) && på(i + 1)) return true;
  }
  return false;
}

/**
 * Om någon av filmens regissörer står med efternamn i slugen.
 *
 * Regissören kommer ur beskrivningen, där alla tre biograferna skriver
 * "Regi: Alejandro G. Iñárritu" först. Efternamnet och inte hela namnet:
 * tidningen skriver "alejandro-gonzalez-inarritu" där biografen skriver
 * "Alejandro G. Iñárritu". Minst fyra bokstäver, så att Lee och Ray inte
 * räcker.
 */
function regissörISlugen(ord, beskrivning) {
  // Fram till nästa mening. Punkten efter en initial ("G.") avslutar ingen.
  const regi = /Regi:\s*([^·\n]+)/.exec(String(beskrivning ?? ''))?.[1]
    ?.split(/(?<=\p{L}{2})\.(?:\s|$)/u)[0];
  if (!regi) return false;
  return regi.split(/,|\boch\b|&/)
    .map((namn) => slugify(namn).split('-').filter(Boolean).at(-1))
    .some((efternamn) => efternamn && efternamn.length >= 4 && ord.includes(efternamn));
}

/** En films uppsättningar, en per biograf, ur repertoaren. */
function filmensUppsättningar(nyckel, productions, filmhus = FILMHUS) {
  return (productions ?? []).filter((p) => filmhus.has(p?.venue_slug) && filmnyckel(p.title) === nyckel);
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

  // Utan premiärdatum: recensionen får inte vara publicerad långt efter att
  // uppsättningen slutat spelas. "Långt" och inte "efter": en konsert spelas
  // en kväll och recenseras dagen därpå, och med en gräns vid sista
  // föreställningen kunde ingen konsertrecension någonsin matcha - DN:s
  // "Laura Misch blomstrar på Faschings scen" föll just så.
  const sista = p?.last_at ? new Date(p.last_at).getTime() : NaN;
  if (!Number.isNaN(sista) && publicerad.getTime() > sista + EFTERÅT_DYGN * 86_400_000) return 'utanför';
  return 'okänt';
}

/** Alla registrerade hus har ett alias. Vaktas av tests/review-match.test.mjs. */
export function husUtanAlias(venues = VENUES) {
  return venues.filter((v) => !HUSALIAS[v.slug]).map((v) => v.slug);
}

/**
 * En matchad recension som rad i reviews-tabellen.
 *
 * Används av insamlingen och av den lokala servern, så att båda ger exakt
 * samma form som sidan läser. Adressen tas utan spårningskoder: flödena
 * hänger på utm-parametrar, och samma artikel med två spårningskoder är
 * fortfarande en recension, inte två.
 */
export function reviewRow(post, träff, production) {
  const url = utanSpårning(post?.url);
  const publicerad = post?.published ? new Date(post.published) : null;
  return {
    url,
    publisher: post?.publisher ?? null,
    title: post?.title ?? null,
    description: post?.description ?? null,
    published_at: publicerad && !Number.isNaN(publicerad.getTime()) ? publicerad.toISOString() : null,
    production_key: träff.production_key,
    // En filmträff har ingen enskild uppsättning: filmen visas kanske på
    // tre biografer. Titeln och kategorin kommer då ur träffen, och huset
    // lämnas tomt.
    production_title: production?.title ?? träff.production_title ?? null,
    venue_slug: production?.venue_slug ?? null,
    category: production?.category ?? träff.category ?? null,
    confidence: träff.confidence,
  };
}

/**
 * En rad ur reviews-tabellen i den form sidan läser.
 *
 * Uppsättningen slås upp i den aktuella repertoaren när den finns där, för
 * husets namn och kategorin. Har den spelat klart används ögonblicksbilden
 * från matchningen - recensionen ska inte försvinna ur nyhetsvyn för att
 * pjäsen gjort det.
 */
export function reviewForPage(row, productions = []) {
  if (String(row?.production_key ?? '').startsWith('film|')) return filmrecensionForPage(row, productions);
  const p = productions.find((u) => u.production_key === row.production_key);
  return {
    url: row.url,
    title: row.title,
    description: row.description,
    published: row.published_at,
    publisher: publicistNamn(row.publisher),
    confidence: row.confidence,
    production: {
      production_key: row.production_key,
      title: p?.title ?? row.production_title,
      venue: p?.venue ?? venueBySlug(row.venue_slug)?.name ?? null,
      venue_slug: p?.venue_slug ?? row.venue_slug,
      category: p?.category ?? row.category ?? null,
      url: p?.url ?? null,
    },
  };
}

/**
 * En filmrecension i sidans form, med alla biografer som visar filmen nu.
 *
 * production_keys och venue_slugs är listor: korten slår upp recensionen på
 * sin egen nyckel, och husfiltret i Nytt ska hitta den under vilken av
 * biograferna som helst. Visas filmen inte längre står titeln kvar ur raden.
 */
function filmrecensionForPage(row, productions) {
  const visas = filmensUppsättningar(row.production_key, productions);
  const hus = [...new Set(visas.map((p) => p.venue).filter(Boolean))];
  return {
    url: row.url,
    title: row.title,
    description: row.description,
    published: row.published_at,
    publisher: publicistNamn(row.publisher),
    confidence: row.confidence,
    production: {
      production_key: row.production_key,
      production_keys: visas.map((p) => p.production_key),
      title: visas[0]?.title ?? row.production_title,
      venue: hus.length ? hus.join(', ') : 'Film',
      venue_slug: null,
      venue_slugs: [...new Set(visas.map((p) => p.venue_slug))],
      category: 'film',
      url: visas[0]?.url ?? null,
    },
  };
}

/**
 * Samma fråga som matchReview, men ur rubrik och ingress i stället för adress.
 *
 * Adressregeln bär hos Aftonbladet, som skriver huset i slugen. Andra gör det
 * inte: Expressens recension av Antikrist på Dramaten ligger på en adress som
 * bara är rubriken, "sexet-och-sorgen-tappar-sin-svarta", och DN:s adresser
 * säger aldrig "recension". Under en vecka i september fanns sex recensioner
 * av våra hus i flödena, och adressregeln hittade två av dem.
 *
 * Kraven är desamma som för adressen, och ett till:
 *   - huset i texten, också i genitiv ("på Faschings scen", "Dramatens")
 *   - uppsättningens titel som hela ord, minst fyra tecken
 *   - tiden som i matchReview
 *   - aldrig publicerad före premiären, när den är känd: en text om att
 *     Dramaten ska sätta upp något är en nyhet, inte en recension
 *   - exakt en kandidat
 *
 * Säkerheten blir "osäker" utom när premiären bekräftar tiden.
 */
export function matchReviewText(review, productions, { dagar = 21, alias = HUSALIAS } = {}) {
  const adress = parseReviewUrl(review?.url);
  if (adress.segments.some((s) => UTESLUTNA_SEKTIONER.has(s))) return null;

  const ord = slugify(`${review?.title ?? ''} ${review?.description ?? ''}`).split('-').filter(Boolean);
  if (!ord.length) return null;

  // Genitiv-s bort, så att "faschings" och "dramatens" är husen.
  const utanS = ord.map((o) => (o.length > 4 && o.endsWith('s') ? o.slice(0, -1) : o));
  const husträffar = Object.entries(alias)
    .filter(([, namn]) => namn.some((n) => ordContains(ord, n) || ordContains(utanS, n)));
  if (husträffar.length !== 1) return null;
  const [husSlug, husNamn] = husträffar[0];

  const publicerad = review?.published ? new Date(review.published) : null;
  const giltigTid = publicerad && !Number.isNaN(publicerad.getTime()) ? publicerad : null;

  const kandidater = [];
  for (const p of productions ?? []) {
    if (p?.venue_slug !== husSlug) continue;
    const titel = slugify(p?.title);
    if (titel.replace(/-/g, '').length < 4) continue;
    if (!ordContains(ord, titel)) continue;

    const premiär = new Date(p.premiere_at ?? '').getTime();
    if (giltigTid && premiär && giltigTid.getTime() < premiär - 86_400_000) continue;

    const tid = tidsomdöme(p, giltigTid, dagar);
    if (tid === 'utanför') continue;

    kandidater.push({
      production_key: p.production_key,
      confidence: tid === 'inom' ? 'hög' : 'osäker',
      matched_title: titel,
      matched_venue: husNamn.find((n) => ordContains(ord, n) || ordContains(utanS, n)),
      matched_by: 'text',
    });
  }

  if (kandidater.length !== 1) return null;
  return kandidater[0];
}


/** Samma regel som flödestolkningen - se rensaSpårning i lib/rss.mjs. */
export const utanSpårning = rensaSpårning;

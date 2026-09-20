// Rena formateringsfunktioner för listan. Inga DOM-anrop, inga nätanrop –
// därför testbara med node --test utan webbläsare. Samma uppdelning som
// receptbokens ingredients.js och scale.js hade.

// Tiderna kommer som UTC från API:et och ska visas som Stockholmstid. Zonen
// sätts uttalat: en besökare som sitter i Berlin ska se när konserten börjar
// i Stockholm, inte när den börjar enligt hens egen klocka.
const ZON = 'Europe/Stockholm';

const DAG = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZON, weekday: 'long', day: 'numeric', month: 'long',
});
const KLOCKAN = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZON, hour: '2-digit', minute: '2-digit',
});
const DATUMNYCKEL = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZON, year: 'numeric', month: '2-digit', day: '2-digit',
});
const IDAG = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZON, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const DAGMÅNAD = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZON, day: 'numeric', month: 'long',
});
const MEDÅR = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZON, day: 'numeric', month: 'long', year: 'numeric',
});

/** "2026-10-17" i Stockholmstid. Nyckeln som dagsgrupperingen bygger på. */
export function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return DATUMNYCKEL.format(d).replace(/-/g, '-');
}

/** "lördag 17 oktober", med "i dag" och "i morgon" när det stämmer. */
export function dayHeading(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const idag = dayKey(now.toISOString());
  const imorgon = dayKey(new Date(now.getTime() + 86_400_000).toISOString());
  const nyckel = dayKey(iso);

  if (nyckel === idag) return 'I dag';
  if (nyckel === imorgon) return 'I morgon';
  return DAG.format(d);
}

/** "Måndag 15 september 2026" – dagens datum, i Stockholmstid. */
export function today(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return '';
  const text = IDAG.format(d);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Hela dygn mellan två tidpunkter, räknat i kalenderdagar i Stockholm.
 *
 * Skillnaden i millisekunder duger inte: klockan 23:30 i går och 00:30 i dag
 * är en timme isär men två olika dagar, och det är dagarna besökaren räknar.
 * Att gå via dygnsnycklarna gör dessutom sommartidsskiftet ofarligt.
 */
export function daysSince(iso, now = new Date()) {
  const då = dayKey(iso);
  const nu = dayKey(now instanceof Date ? now.toISOString() : now);
  if (!då || !nu) return null;
  return Math.round((Date.parse(`${nu}T00:00:00Z`) - Date.parse(`${då}T00:00:00Z`)) / 86_400_000);
}

/**
 * När uppgifterna senast hämtades, skrivet så att det går att bedöma.
 *
 * Skannern går varje natt. Står det ett datum för en vecka sedan är det inte
 * en detalj utan ett fel – någon adapter har slutat fungera – och då ska raden
 * säga hur gammalt det är utan att besökaren behöver räkna dagar i huvudet.
 * Tom sträng när tiden saknas: då vet vi inte, och att gissa vore värre.
 */
export function fetched(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';

  const dagar = daysSince(iso, now);
  if (dagar === null || dagar <= 0) return `hämtad i dag ${time(iso)}`;
  if (dagar === 1) return `hämtad i går ${time(iso)}`;
  return `hämtad ${DAGMÅNAD.format(d)} – för ${dagar} dagar sedan`;
}

/**
 * Perioderna datumfiltret erbjuder, som ett datumspann.
 *
 * Returnerar { from, to } på formen ÅÅÅÅ-MM-DD, vilket är exakt vad
 * /api/events släpper igenom – där prövas de mot ett strikt datummönster,
 * fyra siffror, två, två, och inget annat. Tom period ger tomma fält, alltså
 * inget filter alls.
 *
 * Allt räknas i Stockholms kalenderdagar. Räknar man i UTC blir "i dag" fel
 * mellan midnatt och två på natten halva året, och det är just då någon sitter
 * och letar efter vad som händer i morgon.
 *
 * Kvar finns en kant: API:et jämför spannet mot UTC-midnatt, så ett evenemang
 * som börjar efter midnatt svensk tid räknas till dagen före. Det gäller lika
 * i drift som lokalt, och scenerna vi läser spelar inte klockan ett på natten.
 */
export function dateRange(period, now = new Date()) {
  const idag = dayKey(now instanceof Date ? now.toISOString() : now);
  if (!idag || !period) return { from: '', to: '' };

  // 0 = söndag, 6 = lördag. Dygnsnyckeln är ett rent datum, så veckodagen går
  // att läsa i UTC utan att zonen kan ställa till det.
  const dag = new Date(`${idag}T00:00:00Z`).getUTCDay();

  switch (period) {
    case 'idag':
      return { from: idag, to: idag };
    case 'imorgon':
      return { from: plusDagar(idag, 1), to: plusDagar(idag, 1) };
    case 'helg':
      // Är det redan helg menas den helg man är i, inte nästa. På en lördag
      // sträcker den sig till söndag, på en söndag är den slut i kväll.
      if (dag === 6) return { from: idag, to: plusDagar(idag, 1) };
      if (dag === 0) return { from: idag, to: idag };
      return { from: plusDagar(idag, 6 - dag), to: plusDagar(idag, 7 - dag) };
    case 'vecka':
      // Härifrån till och med söndag. Inte "sju dagar framåt" – den som
      // frågar efter den här veckan menar veckan, inte en rullande period.
      return { from: idag, to: plusDagar(idag, (7 - dag) % 7) };
    default:
      return { from: '', to: '' };
  }
}

/** Ett datum plus n dygn, fortfarande som ÅÅÅÅ-MM-DD. */
function plusDagar(nyckel, n) {
  const d = new Date(`${nyckel}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Speltiden för en uppsättning: "25 november - 23 mars 2027, 60 föreställningar".
 *
 * Året skrivs ut bara när det skiljer sig från det vi är i. "16 september"
 * räcker i september 2026, medan "23 mars 2027" behöver sitt år för att inte
 * läsas som i våras. Det är samma regel en människa följer när hon berättar
 * vad som spelas.
 *
 * En ensam föreställning får inget antal efter sig. "1 föreställning" är
 * information som inte tillför något - datumet säger redan allt.
 */
export function runLabel(firstIso, lastIso, performances = 1, now = new Date()) {
  // Tomt värde före new Date(): new Date(null) är epoch och alltså giltigt, så
  // en rad utan premiärdatum hade skrivits ut som "1 januari 1970".
  if (!firstIso) return '';

  const första = new Date(firstIso);
  if (Number.isNaN(första.getTime())) return '';

  const sista = new Date(lastIso ?? firstIso);
  const nuÅr = år(now);
  const datum = (d) => (år(d) === nuÅr ? DAGMÅNAD.format(d) : MEDÅR.format(d));

  const spann = Number.isNaN(sista.getTime()) || dayKey(firstIso) === dayKey(sista.toISOString())
    ? datum(första)
    : `${datum(första)} – ${datum(sista)}`;

  return performances > 1 ? `${spann}, ${performances} föreställningar` : spann;
}

function år(d) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: ZON, year: 'numeric' }).format(d);
}

/** "20:00" */
export function time(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : KLOCKAN.format(d);
}

/**
 * Priset som en rad.
 *
 * Gratis skrivs ut, för det är ett säljargument och inte ett saknat värde.
 * Saknas priset skrivs ingenting alls – "0 kr" och "okänt pris" är olika
 * saker, och att blanda ihop dem får någon att stå i dörren utan pengar.
 */
export function price(min, max, currency = 'SEK') {
  if (min === null || min === undefined) return '';
  const enhet = currency === 'SEK' ? 'kr' : currency;
  if (min === 0 && (max === 0 || max === null || max === undefined)) return 'Fri entré';
  if (max === null || max === undefined || max === min) return `${tal(min)} ${enhet}`;
  return `${tal(min)}–${tal(max)} ${enhet}`;
}

function tal(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n));
}

/**
 * Huset och rummet som en rad: "Dramaten, Stora scenen".
 *
 * Huset först, för det är det besökaren väljer – rummet hittar man på plats.
 * Är de samma sträng skrivs den en gång: Kulturhuset har evenemang där rummet
 * inte är utsatt, och "Kulturhuset Stadsteatern, Kulturhuset Stadsteatern"
 * ser ut som ett fel även när det inte är det.
 */
export function venueLabel(venue, stage) {
  const hus = String(venue ?? '').trim();
  const rum = String(stage ?? '').trim();

  if (!hus) return rum;
  if (!rum || rum.toLowerCase() === hus.toLowerCase()) return hus;
  return `${hus}, ${rum}`;
}

/**
 * Förkortar en beskrivning till ett utdrag.
 *
 * Vi återpublicerar inte arrangörens hela text – se avsnitt 7 i
 * docs/projektstart.md. Kapningen söker en meningsgräns först, för att ett
 * utdrag som slutar mitt i en sats läser sig som ett fel och inte som ett val.
 */
export function utdrag(text, max = 180) {
  const rensad = String(text ?? '').trim();
  if (rensad.length <= max) return rensad;

  const kapad = rensad.slice(0, max);
  const punkt = kapad.lastIndexOf('. ');
  if (punkt > max * 0.5) return kapad.slice(0, punkt + 1);
  const mellanslag = kapad.lastIndexOf(' ');
  return `${kapad.slice(0, mellanslag > 0 ? mellanslag : max)} …`;
}

/**
 * Evenemangen grupperade per dag, i ordning.
 *
 * Listan kommer redan sorterad från API:et, så grupperingen behåller den
 * ordning den fick och sorterar inte om. Sorterar man om här kan sidan visa en
 * annan ordning än API:et lovade, och skillnaden syns bara ibland.
 */
export function groupByDay(events) {
  const dagar = [];
  let aktuell = null;

  for (const event of events ?? []) {
    const nyckel = dayKey(event?.starts_at);
    if (!nyckel) continue;
    if (!aktuell || aktuell.key !== nyckel) {
      aktuell = { key: nyckel, heading: dayHeading(event.starts_at), events: [] };
      dagar.push(aktuell);
    }
    aktuell.events.push(event);
  }
  return dagar;
}

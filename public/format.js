// Rena formateringsfunktioner för listan. Inga DOM-anrop, inga nätanrop –
// därför testbara med node --test utan webbläsare. Samma uppdelning som
// receptbokens ingredients.js och scale.js hade.

// Tiderna kommer som UTC från API:et och ska visas som Stockholmstid. Zonen
// sätts uttalat: en besökare som sitter i Berlin ska se när konserten börjar
// i Stockholm, inte när den börjar enligt hens egen klocka.
const ZON = 'Europe/Stockholm';

// Året står alltid med. Förr skrevs det bara när datumet låg ett annat år än
// i dag, men "lördag 3 oktober" lämnade läsaren att räkna ut vilket år - och
// med utställningar som pågår till 2028 blev det ofta fel gissat.
const DAG = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZON, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
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

/** "lördag 17 oktober 2026", med "i dag" och "i morgon" när det stämmer. */
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
  return `hämtad ${MEDÅR.format(d)} – för ${dagar} dagar sedan`;
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
 * Speltiden för en uppsättning: "25 november 2026 – 23 mars 2027, 60
 * föreställningar".
 *
 * Året står alltid med. Ligger båda datumen samma år skrivs det en gång, i
 * slutet: "25 april – 29 november 2026".
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

  const spann = Number.isNaN(sista.getTime()) || dayKey(firstIso) === dayKey(sista.toISOString())
    ? MEDÅR.format(första)
    : `${år(första) === år(sista) ? DAGMÅNAD.format(första) : MEDÅR.format(första)} – ${MEDÅR.format(sista)}`;

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
export function groupByDay(events, now = new Date()) {
  const dagar = [];
  let aktuell = null;
  const idag = dayKey(now.toISOString());

  for (const event of events ?? []) {
    let nyckel = dayKey(event?.starts_at);
    if (!nyckel) continue;

    // Det som började före i dag och inte har slutat - en utställning som
    // öppnade i april - hör inte hemma under en rubrik i april. Det samlas
    // under "Pågår nu", som hamnar först eftersom listan är sorterad på start.
    const pågår = nyckel < idag && new Date(event.ends_at ?? '').getTime() >= now.getTime();
    if (pågår) nyckel = 'pågår';

    if (!aktuell || aktuell.key !== nyckel) {
      aktuell = { key: nyckel, heading: pågår ? 'Pågår nu' : dayHeading(event.starts_at), events: [] };
      dagar.push(aktuell);
    }
    aktuell.events.push(event);
  }
  return dagar;
}

/**
 * Nyhetsvyns urval efter scen och kategori.
 *
 * Görs i webbläsaren, eftersom /api/news inte tar parametrar (se
 * functions/api/news.js). En recension följer uppsättningen den matchats mot;
 * en recension utan uppsättning hör inte till någon scen eller kategori och
 * faller bort så fort något filter är på.
 */
export function filtreraNytt({ productions = [], reviews = [] } = {}, { venue = '', category = '' } = {}) {
  const passar = (p) => Boolean(p)
    && (!venue || p.venue_slug === venue)
    && (!category || p.category === category);
  const filtrerar = Boolean(venue || category);
  return {
    productions: filtrerar ? productions.filter(passar) : productions,
    reviews: filtrerar ? reviews.filter((r) => passar(r.production)) : reviews,
  };
}

/**
 * Speltiden för en rad som täcker mer än en kväll: "Spelas 13 september –
 * 8 november".
 *
 * Kulturhuset publicerar en pjäs som ett enda Event med startDate på första
 * och endDate på sista föreställningen. Utan den här raden ser en uppsättning
 * som spelas i två månader ut som en enda kväll. En konsert som slutar efter
 * midnatt är däremot en kväll, därav kravet på ett helt dygn.
 *
 * Utställningar pågår, de spelas inte.
 */
export function speltid(event, now = new Date()) {
  const start = new Date(event?.starts_at ?? '');
  const slut = new Date(event?.ends_at ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(slut.getTime())) return '';
  if (slut.getTime() - start.getTime() < 86_400_000) return '';
  const verb = event.category === 'utställning' ? 'Pågår' : 'Spelas';
  return `${verb} ${runLabel(event.starts_at, event.ends_at, 1, now)}`;
}

/**
 * Uppsättningens nyckel för en evenemangsrad. Samma regel som vyn
 * upcoming_productions och productionKey i lib/upcoming.mjs - sidan kan inte
 * importera lib/, så den står här en gång till. tests/format.test.mjs kräver
 * att de två ger samma svar.
 */
export function productionKey(r) {
  if (r?.production_key) return r.production_key;
  if (!r?.source) return null;
  if (r.source === 'konserthuset') {
    const slug = String(r.external_id ?? '').split('/')[0];
    return slug ? `${r.source}|${slug}` : null;
  }
  const bas = r.url ?? r.title;
  return bas ? `${r.source}|${bas}` : null;
}

/** Recensionerna grupperade per uppsättning, nyast först i varje grupp. */
export function recensionerPerUppsättning(reviews = []) {
  const per = new Map();
  for (const r of reviews) {
    const nyckel = r?.production?.production_key;
    if (!nyckel || !r.url) continue;
    if (!per.has(nyckel)) per.set(nyckel, []);
    per.get(nyckel).push(r);
  }
  for (const lista of per.values()) {
    lista.sort((a, b) => String(b.published ?? '').localeCompare(String(a.published ?? '')));
  }
  return per;
}

/** "Aftonbladet 17 september 2026" - tidningen och dagen, för länken på kortet. */
export function recensionsetikett(r) {
  const d = new Date(r?.published ?? '');
  const dag = Number.isNaN(d.getTime()) ? '' : MEDÅR.format(d);
  return [r?.publisher, dag].filter(Boolean).join(' ');
}

/**
 * Evenemanget som kalenderfil (iCalendar), eller null när det inte passar i
 * en kalender.
 *
 * Det som pågår mer än ett dygn - en utställning som öppnade i april och
 * stänger i november - får ingen fil: en kalenderpost på sju månader hjälper
 * ingen att komma dit. Saknas sluttid, eller är den orimlig, blir det två
 * timmar.
 *
 * Tiderna skrivs i UTC (…Z), så att kalendern själv räknar om till rätt zon.
 * Raderna viks vid 75 byte, som formatet kräver; långa beskrivningar bröt
 * annars importen i Outlook.
 */
export function kalenderfil(event, now = new Date()) {
  const start = new Date(event?.starts_at ?? '');
  if (!event?.title || Number.isNaN(start.getTime())) return null;
  const slut = new Date(event.ends_at ?? '');
  const längd = slut.getTime() - start.getTime();
  if (längd > 86_400_000) return null;
  const s = Number.isNaN(längd) || längd <= 0 ? new Date(start.getTime() + 2 * 3600_000) : slut;

  const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  // Omvänt snedstreck, semikolon, komma och radbrytning är syntax i formatet.
  const text = (v) => String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
  const plats = [event.venue, event.stage, event.address].filter(Boolean).join(', ');
  const beskrivning = [
    event.description ? utdrag(event.description, 300) : null,
    event.url ? `Mer: ${event.url}` : null,
    event.ticket_url && event.ticket_url !== event.url ? `Biljetter: ${event.ticket_url}` : null,
  ].filter(Boolean).join('\n');

  const rader = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kulturkalendern//SV',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${text(`${event.source ?? 'x'}-${event.external_id ?? event.id ?? event.starts_at}`)}@kulturkalendern`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(s)}`,
    `SUMMARY:${text(event.title)}`,
    plats ? `LOCATION:${text(plats)}` : null,
    beskrivning ? `DESCRIPTION:${text(beskrivning)}` : null,
    event.url ? `URL:${event.url}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return `${rader.map(vik).join('\r\n')}\r\n`;
}

/** En rad vikt vid 75 byte, utan att dela ett tecken på mitten. */
function vik(rad) {
  const delar = [];
  let aktuell = '';
  let byte = 0;
  for (const tecken of rad) {
    const n = new TextEncoder().encode(tecken).length;
    const gräns = delar.length ? 74 : 75; // fortsättningsraderna börjar med ett mellanslag
    if (byte + n > gräns) {
      delar.push(aktuell);
      aktuell = '';
      byte = 0;
    }
    aktuell += tecken;
    byte += n;
  }
  delar.push(aktuell);
  return delar.join('\r\n ');
}

/** Filnamnet för kalenderfilen: "girl-6-2026-10-04.ics". */
export function kalenderfilnamn(event) {
  const namn = String(event?.title ?? 'evenemang').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'evenemang';
  return `${namn}-${dayKey(event?.starts_at) ?? 'datum'}.ics`;
}

/**
 * Det som delas: "Girl 6 – Cinemateket, lördag 4 oktober 2026 18:00", och
 * arrangörens sida som länk. Utställningar och annat som pågår får speltiden
 * i stället för ett klockslag.
 */
export function delning(event, now = new Date()) {
  const spann = speltid(event, now);
  // Alltid datumet, aldrig "i morgon": mottagaren läser kanske i övermorgon.
  const start = new Date(event?.starts_at ?? '');
  const dag = Number.isNaN(start.getTime()) ? null : DAG.format(start);
  const när = spann || [dag, time(event?.starts_at)].filter(Boolean).join(' ');
  const var_ = [event?.venue, event?.stage].filter(Boolean).join(', ');
  return {
    title: event?.title ?? '',
    text: [event?.title, var_ ? `– ${var_}` : null].filter(Boolean).join(' ') + (när ? `, ${när.charAt(0).toLowerCase()}${när.slice(1)}` : ''),
    url: event?.url || event?.ticket_url || null,
  };
}

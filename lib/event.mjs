// schema.org Event → en rad i vår databas.
//
// Tredje domänen som läser samma sorts data: leasingskannern läste @type:
// Product, receptboken @type: Recipe, den här läser @type: Event. lib/ldjson.mjs
// är oförändrad sedan dess – det är hela poängen med att hålla den generisk.
//
// Håll filen fri från Node-API:er. Den körs av node --test och av skannern, och
// ska kunna köras av en Pages Function utan ändring.

import { extractAllJsonLd, hasType } from './ldjson.mjs';
import { clean, first, toArray } from './text.mjs';

// Undertyperna ärver alla av Event. Att leta efter var och en i stället för att
// bara ta "Event" är skillnaden mellan att hitta en konsert och att missa den:
// sajter som sätter en specifik typ sätter sällan även den generiska.
export const EVENT_TYPES = [
  'Event',
  'MusicEvent', 'TheaterEvent', 'DanceEvent', 'ComedyEvent',
  'ScreeningEvent', 'ExhibitionEvent', 'Festival', 'LiteraryEvent',
  'ChildrensEvent', 'EducationEvent', 'SocialEvent', 'VisualArtsEvent',
];

// Våra kategorier. Medvetet få – en filterrad som inte får plats på en telefon
// filtrerar ingenting.
const TYPE_CATEGORY = {
  musicevent: 'konsert',
  theaterevent: 'teater',
  danceevent: 'dans',
  comedyevent: 'humor',
  screeningevent: 'film',
  exhibitionevent: 'utställning',
  visualartsevent: 'utställning',
  festival: 'festival',
  literaryevent: 'litteratur',
  childrensevent: 'barn',
  educationevent: 'föreläsning',
};

// Faller @type tillbaka på generiska "Event" får sajtens egen genretext avgöra.
// Det är inte en snygghetsdetalj: Kulturhuset Stadsteatern skriver "Event" och
// lägger "Konserter" i genre, så utan den här tabellen hamnar varenda konsert
// de publicerar under "övrigt".
// Ordningen är betydelsebärande: det mer specifika ordet ska vinna. "Operakonsert"
// är opera, inte konsert, och "barnteater" är barn, inte teater. Därför står de
// snäva mönstren först och de vida sist.
const GENRE_CATEGORY = [
  [/opera|musikal/i, 'opera'],
  [/barn|familj|ungdom/i, 'barn'],
  [/konsert|musik|live|klubb|jazz|rock|pop|klassisk/i, 'konsert'],
  [/teater|scenkonst|drama|pjäs|föreställning/i, 'teater'],
  [/dans|balett/i, 'dans'],
  [/utställ|konst|galleri|museum/i, 'utställning'],
  [/film|bio|visning/i, 'film'],
  [/föreläsning|samtal|seminarium|panel/i, 'föreläsning'],
  [/litteratur|poesi|bok|uppläsning/i, 'litteratur'],
  [/humor|ståupp|stand-?up/i, 'humor'],
  // schema.org saknar CircusEvent, så cirkus finns bara som genretext. Utan
  // raden hamnar Kulturhusets hela cirkusprogram under "övrigt" – upptäckt i
  // torrkörningen, inte i testerna, eftersom fixturerna bara hade konserter.
  [/cirkus|nycirkus/i, 'cirkus'],
  [/festival/i, 'festival'],
];

/**
 * Alla kategorier category() kan returnera.
 *
 * Exporterad för att listan finns på tre ställen som måste hållas i takt:
 * här, vitlistan i functions/api/events.js, och filterknapparna i
 * public/app.js. De två sistnämnda kan inte importera härifrån – app.js
 * serveras ur public/ och når inte lib/ – så tests/kategorier.test.mjs
 * jämför dem som text i stället. Glider de isär blir en kategori osynlig
 * i gränssnittet eller avvisad av API:et, och båda felen är tysta.
 */
export const CATEGORIES = [
  'konsert', 'teater', 'opera', 'dans', 'utställning', 'film',
  'barn', 'föreläsning', 'litteratur', 'humor', 'cirkus', 'festival', 'övrigt',
];

const STATUS = {
  eventscheduled: 'scheduled',
  eventcancelled: 'cancelled',
  eventpostponed: 'postponed',
  eventrescheduled: 'rescheduled',
  eventmovedonline: 'moved-online',
};

/** Alla evenemang på en sida. En sida kan bära flera – ett program per datum. */
export function eventsFromHtml(html, { sourceUrl } = {}) {
  return eventNodes(html)
    .map((node) => toEvent(node, { sourceUrl }))
    .filter(Boolean);
}

/** Alla ld+json-noder på sidan som är ett Event av något slag. */
export function eventNodes(html) {
  return extractAllJsonLd(html)
    .filter((node) => EVENT_TYPES.some((type) => hasType(node, type)));
}

/**
 * Om sidan över huvud taget bär ett Event-block.
 *
 * Skild från eventsFromHtml för att adaptrarna ska kunna skilja två fall som
 * annars ser likadana ut: en arkivsida har ett fullgott Event-block men saknar
 * startDate, medan en sajt som lagt om sitt format inte har något block alls.
 * Det första är normalt, det andra är ett larm – och att behandla dem lika ger
 * antingen falska larm varje natt eller tystnad den dag formatet ändras.
 */
export function hasEventNode(html) {
  return eventNodes(html).length > 0;
}

/**
 * Ett ld+json-Event till vår radform.
 *
 * source och external_id sätts av adaptern – den här funktionen vet inte vilken
 * källa noden kom ifrån, och ska inte behöva veta det.
 *
 * Returnerar null om noden saknar titel eller starttid. Ett evenemang utan
 * någon av dem går inte att vare sig visa eller sortera, och en halvtom rad i
 * listan är sämre än ingen rad alls.
 */
export function toEvent(node, { sourceUrl } = {}) {
  if (!node || typeof node !== 'object') return null;

  const title = clean(first(node.name) ?? first(node.headline));
  const starts_at = parseDateTime(first(node.startDate));
  if (!title || !starts_at) return null;

  const place = first(node.location);
  const offer = bestOffer(node.offers);

  return {
    url: clean(first(node.url)) ?? sourceUrl ?? null,
    title,
    description: clean(first(node.description)),
    image_url: imageUrl(node.image, sourceUrl),
    category: category(node),
    genre: clean(first(node.genre)),
    venue_raw: placeName(place),
    address: placeAddress(place),
    starts_at,
    ends_at: parseDateTime(first(node.endDate)),
    price_min: offer.min,
    price_max: offer.max,
    currency: offer.currency,
    ticket_url: offer.url,
    status: eventStatus(first(node.eventStatus)),
    organizer: organizerName(node),
    raw: node,
  };
}

/**
 * Vilken av våra kategorier evenemanget hör till.
 *
 * @type först, genretexten sedan. Ordningen spelar roll: en TheaterEvent med
 * genre "Höstens program" är teater, inte övrigt.
 */
export function category(node) {
  for (const type of toArray(node?.['@type'])) {
    const träff = TYPE_CATEGORY[String(type).toLowerCase()];
    if (träff) return träff;
  }

  // Fälten prövas var för sig och i tur och ordning, aldrig ihopslagna.
  //
  // Slår man ihop dem vinner det mönster som står först i tabellen, oavsett
  // vilket fält träffen kom ur – och keywords är nästan alltid skräpigast.
  // Kulturhuset skriver "kulturhuset stadsteatern" i keywords på varenda sida,
  // och "stadsTEATERn" innehåller "teater". Med hopslagen text blev därför 71
  // av 126 rader teater, inklusive samtliga utställningar, dansföreställningar
  // och litteraturkvällar. Det syntes inte i testerna, som bara satte genre.
  for (const fält of [first(node?.genre), first(node?.additionalType), node?.keywords]) {
    const text = clean(fält);
    if (!text) continue;
    for (const [mönster, kategori] of GENRE_CATEGORY) {
      if (mönster.test(text)) return kategori;
    }
  }
  return 'övrigt';
}

/**
 * Datum och tid som ISO-sträng i UTC, med tidszonen uttolkad först.
 *
 * Det här är inte överarbetat. Dramaten skriver "2026-09-18T19:00:00" utan
 * zon, skannern kör på GitHub Actions i UTC, och JS tolkar en zonlös sträng
 * som *lokal* tid. En föreställning klockan 19 hade då hamnat 19 UTC i
 * databasen i stället för 17 – alltså visats som 21 i listan halva året och 20
 * den andra halvan. Ett fel som ser rimligt ut och därför aldrig upptäcks.
 * Saknas zonen antar vi Stockholm.
 */
export function parseDateTime(value, { assumeZone = 'Europe/Stockholm' } = {}) {
  const text = clean(value);
  if (!text) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (!m) return null;

  const [, år, månad, dag, timme = '00', minut = '00', sekund = '00', zon] = m;
  const vägg = `${år}-${månad}-${dag}T${timme}:${minut}:${sekund}`;

  const offset = zon
    ? (zon === 'Z' ? '+00:00' : zon.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2'))
    : zonOffset(vägg, assumeZone);

  const d = new Date(`${vägg}${offset}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Månadsnamnen som svenska sajter skriver dem. Förkortningarna finns med för
// att de förekommer: "26 nov 2026" står på lika många sidor som "26 november".
const MÅNADER = {
  januari: 1, jan: 1, februari: 2, feb: 2, mars: 3, mar: 3, april: 4, apr: 4,
  maj: 5, juni: 6, jun: 6, juli: 7, jul: 7, augusti: 8, aug: 8,
  september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

/**
 * Ett datum ur svensk fritext: "Urpremiär 26 november 2026" blir 2026-11-26.
 *
 * Finns för premiärdatumen. Dramaten skriver dem som en mening och inte som
 * ett fält - "Urpremiär", "Nypremiär", "Svensk premiär" följt av datumet - och
 * premiären är den starkaste signalen som finns för att koppla en recension
 * till en uppsättning. Utan den vet vi bara när nästa föreställning är, vilket
 * för en pjäs som hade premiär i augusti är något helt annat.
 *
 * Returnerar midnatt svensk tid som ISO, eller null. Klockslag ingår aldrig:
 * en premiär är ett datum i de här texterna, och att hitta på en tid vore att
 * påstå något källan inte sagt.
 */
export function parseSwedishDate(value, { assumeZone = "Europe/Stockholm" } = {}) {
  const text = clean(value);
  if (!text) return null;

  // Dag, månadsnamn, år - i den ordningen, var som helst i strängen. Året är
  // valfritt: står det inte där finns inget rimligt att gissa, och då är null
  // rätt svar.
  const m = new RegExp("(?:^|[^0-9])([0-9]{1,2})[ ]*([a-zåäö]+)[ ]+([0-9]{4})", "i").exec(text);
  if (!m) return null;

  const månad = MÅNADER[m[2].toLowerCase()];
  const dag = Number(m[1]);
  if (!månad || dag < 1 || dag > 31) return null;

  const iso = `${m[3]}-${String(månad).padStart(2, "0")}-${String(dag).padStart(2, "0")}`;
  const d = parseDateTime(iso, { assumeZone });
  // Kontrollera att texten var ett verkligt datum: Date rullar 31 februari
  // vidare till 3 mars utan att klaga. Jämförelsen sker mitt på dagen i UTC
  // och inte mot parseDateTimes svar - midnatt i Stockholm ligger dagen före
  // i UTC, och att jämföra dem gav noll träffar på allt.
  if (new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) !== iso) return null;

  return parseDateTime(iso, { assumeZone });
}
/**
 * Tidszonens offset vid en given väggklocka, utan tidszonsbibliotek.
 *
 * Två varv: första gissningen tolkar väggtiden som UTC och frågar vilken
 * offset zonen hade då, andra varvet rättar med den. Det andra varvet finns
 * för sommartidsskiftet – natten då klockan ställs om ger första gissningen
 * fel sida av skiftet.
 */
function zonOffset(vägg, timeZone) {
  let offset = läsOffset(new Date(`${vägg}Z`), timeZone);
  for (let i = 0; i < 2; i += 1) {
    const nyOffset = läsOffset(new Date(`${vägg}${offset}`), timeZone);
    if (nyOffset === offset) break;
    offset = nyOffset;
  }
  return offset;
}

function läsOffset(date, timeZone) {
  if (Number.isNaN(date.getTime())) return '+00:00';
  const del = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  const m = /GMT([+-]\d{2}:\d{2})/.exec(del?.value ?? '');
  return m ? m[1] : '+00:00';
}

/**
 * Pris ur offers. Kan vara ett erbjudande eller flera – flera betyder oftast
 * prisklasser, och då är billigast och dyrast det intressanta.
 */
export function bestOffer(offers) {
  const priser = [];
  let currency = null;
  let url = null;

  for (const offer of toArray(offers)) {
    if (!offer || typeof offer !== 'object') continue;
    for (const fält of [offer.price, offer.lowPrice, offer.highPrice]) {
      priser.push(...parsePrices(fält));
    }
    currency ??= clean(first(offer.priceCurrency));
    url ??= clean(first(offer.url));
  }

  if (!priser.length) return { min: null, max: null, currency, url };
  return { min: Math.min(...priser), max: Math.max(...priser), currency: currency ?? 'SEK', url };
}

/**
 * Alla tal i ett prisfält.
 *
 * price är enligt schema.org ett tal, men Kulturhuset skriver "175-350" när
 * föreställningen har flera prisklasser. Läser man det med parseFloat får man
 * 175 och tappar taket – biljetten kostar då dubbelt så mycket som listan lovar
 * i värsta fall. Därför plockas alla tal ut, inte det första.
 *
 * Tusentalsavgränsaren måste bort före siffersökningen: "1 275" är ett pris,
 * inte två. Svenska sajter skriver både vanligt mellanslag och hårt.
 */
export function parsePrices(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? [value] : [];

  const text = String(value ?? '')
    .replace(/(\d)[\s ](?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d),(\d)/g, '$1.$2');

  return [...text.matchAll(/\d+(?:\.\d+)?/g)]
    .map((m) => Number.parseFloat(m[0]))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/** Scenens namn. Place-objekt eller bara en sträng – sajter gör båda. */
export function placeName(place) {
  if (!place) return null;
  if (typeof place === 'string') return clean(place);
  return clean(first(place.name)) ?? clean(first(place.address?.streetAddress));
}

/** Adressen som en läsbar rad, inte som ett objekt ingen vill se. */
export function placeAddress(place) {
  const adress = place?.address;
  if (!adress) return null;
  if (typeof adress === 'string') return clean(adress);
  const delar = [adress.streetAddress, adress.postalCode, adress.addressLocality]
    .map((d) => clean(first(d)))
    .filter(Boolean);
  return delar.length ? delar.join(', ') : null;
}

/** schema.org-URL:en till vårt korta ord. Okänt värde är inte "inställt". */
export function eventStatus(value) {
  const text = clean(value);
  if (!text) return 'scheduled';
  const sista = text.split('/').pop().toLowerCase();
  return STATUS[sista] ?? 'scheduled';
}

/** Bilden kan vara en sträng, en array, eller ett ImageObject. Alla tre finns. */
export function imageUrl(value, sourceUrl) {
  for (const kandidat of toArray(value)) {
    const url = clean(typeof kandidat === 'object' ? first(kandidat?.url) : kandidat);
    if (!url) continue;
    try {
      return new URL(url, sourceUrl ?? undefined).href;
    } catch {
      continue;
    }
  }
  return null;
}

function organizerName(node) {
  for (const kandidat of [node.organizer, node.performer, node.superEvent]) {
    const item = first(kandidat);
    if (!item) continue;
    const namn = clean(typeof item === 'object' ? first(item.name) : item);
    if (namn) return namn;
  }
  return null;
}

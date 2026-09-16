// Konserthuset Stockholm.
//
// Undersökningen i docs/projektstart.md avsnitt 4 satte Konserthuset på nivå 3:
// "varken ld+json eller sitemap, bara og:-taggar och datum i URL-slugen". Det
// stämmer om man tittar på en enskild evenemangssida. Det gör inte adaptern.
//
// Kalendern på /program-och-biljetter/kalender/ är serverrenderad och märkt med
// **mikrodata** – varje kort är ett `itemscope itemtype="schema.org/MusicEvent"`
// med itemprop för name, description, image, startDate, endDate och location,
// plus pris i klartext och biljettlänk. Det är alltså inte nivå 3 utan samma
// sorts källa som Kulturhuset, uttryckt i attribut i stället för i ett
// JSON-block. Nivå 3 finns kvar som beskrivning av *detaljsidan*, och den
// behöver aldrig hämtas.
//
// Listan laddas i klumpar av en POST till /CalendarSlideBlock/LoadMore/ –
// samma anrop sidans "Visa fler"-knapp gör. Hela programmet, 295 rader ut till
// juni 2027 vid skrivande stund, kostar sex anrop. Alternativet, en hämtning
// per evenemangssida, hade kostat 295 och gett mindre.
//
// Ett kort per föreställning, inte per uppsättning: slugen bär
// .../schumanns-tredje-symfoni/20260916-1800/, så samma konsert två kvällar
// blir två rader med var sitt id. Samma modell som Dramaten, och den listan
// faktiskt vill visa.
//
// Saknas: ingenting väsentligt. Pris finns som intervall ("150-420 kr"),
// sluttid finns som endDate. Fyra av trettio kort saknar prisrad – då skriver
// adaptern null i stället för att gissa på noll.

import { fetchText, fetchWithRetry, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime, parsePrices } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://www.konserthuset.se';
const KALENDER = `${BAS}/program-och-biljetter/kalender/`;
const LADDA_MER = `${BAS}/CalendarSlideBlock/LoadMore/`;

// Femtio rader per anrop. Varje kort är ~35 kB markup eftersom det bär hela
// detaljsidan hopfälld, så en klump på femtio är knappt 2 MB – stort men
// hanterligt, och sex anrop i stället för trettio är snällare mot källan.
const SIDSTORLEK = 50;

// Spärr mot en oändlig slinga om sajten skulle sluta minska antalet rader.
// Tusen rader är långt mer än husets hela spelår.
const MAX_SIDOR = 20;

/**
 * Våra kategorier ur Konserthusets egna etiketter.
 *
 * Huset är en konsertscen, så konsert är standardvärdet och inte övrigt –
 * samma resonemang som Dramaten gör med teater. Mönstren prövas mot både
 * URL-typen (konsert, extern-konsert, guidad-visning, utstallning) och
 * genre-etiketten ("Kammarmusik", "Barn & familj", "Seminarium", "Utställning").
 *
 * Ordningen är betydelsebärande, precis som i lib/event.mjs: det snävare ordet
 * ska vinna. En familjekonsert hör hemma under barn – den som filtrerar på
 * barn letar efter just den, och den som filtrerar på konsert letar efter en
 * kväll utan barnvakt. Av samma skäl står barn före guidningen: husets
 * familjevisning "Bland cellofodral och partitur" är något man går på med
 * barnen, och under övrigt hade ingen hittat den.
 *
 * Skolkonserterna får däremot förbli konsert. Sajten märker dem "Skola", de
 * bokas av klasser och inte av familjer, och att lägga dem under barn vore att
 * visa dem för föräldrar som inte kan köpa biljett.
 */
const KATEGORIER = [
  [/barn|familj/i, 'barn'],
  [/seminarium|samtal|föreläsning|workshop/i, 'föreläsning'],
  [/guidad|visning/i, 'övrigt'],
  [/utställ|utstallning|konst och arkitektur/i, 'utställning'],
  [/film|bio/i, 'film'],
  [/dans|balett/i, 'dans'],
];

export default {
  id: 'konserthuset',
  label: 'Konserthuset Stockholm',
  enabled: true,

  // hämta, laddaMer, paus och robotsOk injiceras av testerna. Standardvärdena
  // är det skarpa läget – ett test som råkar gå ut på nätet är inget test.
  async fetchEvents({
    log = console.log,
    hämta = fetchText,
    laddaMer = hämtaKlump,
    paus = sleep,
    robotsOk = isAllowedByRobots,
    now = new Date(),
    take = SIDSTORLEK,
  } = {}) {
    // Båda sökvägarna kollas. robots.txt stänger /episerver/cms men inte de
    // här – och det är just därför det ska kollas varje gång och inte antas
    // en gång i september.
    for (const url of [KALENDER, LADDA_MER]) {
      if (!(await robotsOk(url))) {
        throw new Error(`robots.txt tillåter inte hämtning av ${new URL(url).pathname}`);
      }
    }

    const { guid, date } = kalenderTillstånd(await hämta(KALENDER), { now });
    if (!guid) {
      throw new Error('kalendersidan bar ingen contentGuid – sidan kan ha lagts om');
    }
    await paus(1200);

    const ut = [];
    const sedda = new Set();
    let skip = 0;
    let kort = 0;     // kort sajten skickat
    let tolkade = 0;  // kort som gav en rad, dubbletter inräknade
    let slut = false; // sajten sa att det inte finns mer

    for (let sida = 0; sida < MAX_SIDOR; sida += 1) {
      const svar = await laddaMer({ guid, date, skip, take });
      const html = svar?.html ?? '';
      const bitar = cards(html);
      if (!bitar.length) {
        slut = true;
        break;
      }

      kort += bitar.length;
      for (const bit of bitar) {
        const rad = parseCard(bit);
        if (!rad) continue;
        tolkade += 1;

        // Dubbletter: klumparna räknas med skip, och skiftar kalendern mellan
        // två anrop kan en rad komma två gånger. Id:t avgör, inte ordningen.
        //
        // Räknas dubbletterna som tolkningsfel larmar adaptern om en formatändring
        // som inte har hänt – därför tolkade och inte ut.length i kontrollen nedan.
        if (sedda.has(rad.external_id)) continue;
        sedda.add(rad.external_id);
        ut.push(rad);
      }

      skip += bitar.length;
      log(`  ${skip} kort lästa, ${ut.length} rader`);

      // hideSelf är sajtens eget besked om att knappen inte behövs mer.
      if (svar?.hideSelf || bitar.length < take) {
        slut = true;
        break;
      }
      await paus(1200);
    }

    // En spärr som slår till utan att säga det ser ut som ett kort spelår.
    if (!slut) {
      log(`  spärren på ${MAX_SIDOR} klumpar slog till – programmet kan vara längre än ${skip} kort`);
    }

    if (!kort) {
      throw new Error('kalendern gav inga kort – LoadMore-anropet kan ha ändrats');
    }
    // Korten finns men går inte att tolka: då har markupen lagts om, och det
    // är ett larm och inte ett tomt program. Motsvarar Kulturhusets kontroll
    // av att ld+json-blocket finns kvar.
    if (tolkade < kort * 0.5) {
      throw new Error(`bara ${tolkade} av ${kort} kort gick att tolka – markupen kan ha ändrats`);
    }

    log(`  ${ut.length} föreställningar av ${kort} kort`);
    return ut;
  },
};

/**
 * En klump ur kalendern.
 *
 * Samma POST som sidans "Visa fler"-knapp gör. Fälten är knappens egna
 * data-attribut; typefilters tomt betyder inget filter, viewType normal är
 * översiktsvyn. Svaret är JSON med html och hideSelf.
 */
async function hämtaKlump({ guid, date, skip, take }) {
  const res = await fetchWithRetry(LADDA_MER, {
    method: 'POST',
    body: new URLSearchParams({
      date,
      skip: String(skip),
      take: String(take),
      typefilters: '',
      lang: 'sv',
      viewType: 'normal',
      currentBlockId: '0',
      contentGuid: guid,
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      accept: 'application/json',
    },
  });
  return res.json();
}

/**
 * Det kalendersidan måste tala om innan klumparna kan hämtas.
 *
 * guid identifierar kalenderblocket och date är sajtens egen utgångspunkt –
 * båda står i markupen. Saknas datumet faller vi tillbaka på dagens datum i
 * Stockholm, för det är den frågan vi vill ställa: vad händer från och med nu.
 */
export function kalenderTillstånd(html, { now = new Date() } = {}) {
  const text = String(html ?? '');
  return {
    guid: plocka(text, /id="contentGuid"[^>]*data-contentguid="([^"]+)"/)
      ?? plocka(text, /js-calendar-load-more[^>]*data-contentguid="([^"]+)"/),
    date: plocka(text, /js-calendar-load-more[^>]*data-startdate="([^"]+)"/)
      ?? `${dagIStockholm(now)} 00:00:00`,
  };
}

/** Korten i en klump. Ett kort är ett li med sajtens sid-id. */
export function cards(html) {
  return String(html ?? '')
    .split(/(?=<li id="page-)/)
    .filter((bit) => bit.startsWith('<li id="page-'));
}

/** Alla rader i en klump. */
export function eventsFromCalendar(html) {
  return cards(html).map(parseCard).filter(Boolean);
}

/**
 * Ett kort till en rad.
 *
 * Fälten läses med ankare i markupen och inte med en generisk mikrodataläsare:
 * itemprop="name" står på tre ställen i samma kort – rubriken, salen och
 * tonsättaren – och en läsare som bara tar "första name" hämtar ibland
 * Beethoven som titel. Ankarna är därför klassnamnen runt fälten.
 *
 * Returnerar null när titel, tid eller adress saknas. Samma regel som
 * toEvent() i lib/event.mjs: en rad utan dem går varken att visa eller sortera.
 */
export function parseCard(html) {
  const text = String(html ?? '');

  const url = clean(plocka(text, /<span itemprop="url" content="([^"]+)"/));
  const starts_at = parseDateTime(plocka(text, /data-fulltime="([^"]+)"/));
  const title = clean(plocka(text, /<h3 class="calendar-listing-results-header"[^>]*>([\s\S]*?)<\/h3>/));
  if (!url || !starts_at || !title) return null;

  const genre = clean(plocka(text, /<span class="genre-label">([\s\S]*?)<\/span>/));
  const priser = parsePrices(clean(plocka(text, /<dd class="arrangement-price">([\s\S]*?)<\/dd>/)));

  return {
    external_id: externalId(url),
    url,
    title,
    description: clean(plocka(text, /<p class="orfeus-mini-text"[^>]*>([\s\S]*?)<\/p>/)),
    image_url: bildUrl(plocka(text, /<img itemprop="url"[^>]*src="([^"]+)"/)),
    category: categoryFor(url, genre),
    genre,
    // Salen, inte huset. Kortet sätter itemprop="name" på knappen som fäller
    // ut salsbeskrivningen, och den texten är "Stora salen".
    venue_raw: clean(plocka(text, /itemprop="location"[\s\S]{0,600}?itemprop="name"[^>]*>([\s\S]*?)<\//)),
    address: 'Hötorget 8, Stockholm',
    starts_at,
    ends_at: parseDateTime(plocka(text, /itemprop="endDate" content="([^"]+)"/)),
    // Priset står som "150-420 kr". parsePrices tar alla tal, inte det
    // första – annars hade taket fallit bort och listan lovat halva priset.
    price_min: priser.length ? Math.min(...priser) : null,
    price_max: priser.length ? Math.max(...priser) : null,
    currency: 'SEK',
    ticket_url: clean(plocka(text, /href="(https:\/\/biljetter\.konserthuset\.se\/[^"]+)"/)),
    // Kalendern listar inte inställda konserter – de tas bort. Vi har alltså
    // inget att läsa, och att skriva något annat än scheduled vore att hitta på.
    status: 'scheduled',
    organizer: 'Konserthuset Stockholm',
    raw: { url, starts_at, genre },
  };
}

/**
 * Vår kategori ur URL-typen och genre-etiketten.
 *
 * Båda prövas mot samma mönster, och konsert är fallet när inget träffar.
 */
export function categoryFor(url, genre) {
  const text = `${urlTyp(url) ?? ''} ${genre ?? ''}`;

  for (const [mönster, kategori] of KATEGORIER) {
    if (mönster.test(text)) return kategori;
  }
  return 'konsert';
}

/**
 * Sajtens egen typ, ledet efter /kalender/ i adressen: konsert,
 * extern-konsert, guidad-visning, utstallning.
 */
function urlTyp(url) {
  return plocka(String(url ?? ''), /\/kalender\/([a-z0-9-]+)\//);
}

/**
 * Slugen och tidpunkten tillsammans, "schumanns-tredje-symfoni/20260916-1800".
 *
 * Slugen ensam duger inte: samma konsert spelas flera kvällar och delar slug,
 * så elva av tolv hade skrivit över varandra i upserten. Tidpunkten ligger
 * redan i adressen och gör id:t unikt per föreställning – och stabilt, för
 * adressen är den besökaren får i sin webbläsare.
 */
export function externalId(url) {
  const delar = new URL(url, BAS).pathname.split('/').filter(Boolean);
  return delar.slice(-2).join('/');
}

/** Bilden ligger som relativ sökväg med storleksparametrar. Behåll dem. */
function bildUrl(src) {
  const rensad = clean(src);
  if (!rensad) return null;
  try {
    return new URL(rensad, BAS).href;
  } catch {
    return null;
  }
}

/** "2026-09-15" i Stockholmstid. */
function dagIStockholm(now) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function plocka(text, mönster) {
  return mönster.exec(text)?.[1] ?? null;
}

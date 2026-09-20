// Kungliga Operan.
//
// Utredningen 2026-09-15 sa att Operan inte gick att läsa: sidorna bär varken
// ld+json, mikrodata eller datum i markupen, och kalendern skickas som hundra
// tomma platshållare. Det stämde – men slutsatsen var fel, och avsnitt 4 i
// docs/projektstart.md bär rättelsen.
//
// Datan finns i ett eget JSON-API på en egen subdomän. Den syntes inte i
// sajtens huvudbunt, för den byggs av en chunk som bunten importerar
// (assets/ga4-tracking-utils-*.js) och som måste hämtas för sig. Två bas-
// adresser står där: webapi.operan.se för speltillfällen, och
// www.operan.se/contentapi för det redaktionella.
//
// Nivå 0, om man så vill: rent JSON, ingen HTML-tolkning alls. Den rikaste
// källan hittills – och den som såg tunnast ut.
//
// Tre anropstyper:
//   /performances/bymonth?date=ÅÅÅÅ-MM-01   speltillfällen, en månad per anrop
//   /contentapi/sv/productions/content?...   namn, text, genre, bild
//   /contentapi/sv/dictionary                Facility.N → salens namn
//
// Tiderna är äkta UTC. API:et skriver "2026-09-18T16:15:00+00:00" för den
// föreställning sajten visar som 18:15, vilket stämmer på minuten i september.
// Zonen står uttryckt i strängen, så parseDateTime räknar rätt utan att gissa.
//
// Saknas: pris. API:et bär availability, alltså antal lediga platser, men inget
// belopp. Adaptern skriver null i stället för att gissa – samma beslut som
// Dramaten.

import { fetchJson, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime } from '../../lib/event.mjs';
import { clean, toArray } from '../../lib/text.mjs';

const BAS = 'https://www.operan.se';
const WEBAPI = 'https://webapi.operan.se';
const CONTENT = `${BAS}/contentapi/sv`;

// Tolv månader framåt. Sajtens egen månadsväljare visar precis tolv, och
// Operan släpper sällan program längre bort än så.
const MÅNADER = 12;

// Hur många produktioner som får plats i ett innehållsanrop. Id:na blir en
// parameter var, så en obruten lista skulle bli en orimligt lång adress den
// dagen programmet växer.
const KLUMP = 25;

/**
 * Våra kategorier ur Operans egna genrer.
 *
 * Husets lista är kort och stabil: Opera, Operett, Balett/dans, Konsert,
 * Barn & unga, Visning, Publikintroduktion, Evenemang.
 *
 * Barn först, av samma skäl som hos Konserthuset: den som filtrerar på barn
 * letar efter familjeföreställningen, och under opera hittar ingen den. Opera
 * är standardvärdet – det är ett operahus, och en okänd genre är med all
 * sannolikhet opera snarare än övrigt.
 */
const KATEGORIER = [
  [/barn|unga|familj/i, 'barn'],
  [/balett|dans/i, 'dans'],
  [/publikintroduktion|introduktion|samtal|föreläsning/i, 'föreläsning'],
  [/visning|guidad/i, 'övrigt'],
  [/konsert/i, 'konsert'],
  [/opera|operett/i, 'opera'],
];

export default {
  id: 'operan',
  label: 'Kungliga Operan',
  enabled: true,

  async fetchEvents({
    log = console.log,
    hämtaJson = fetchJson,
    paus = sleep,
    robotsOk = isAllowedByRobots,
    now = new Date(),
    månader = MÅNADER,
  } = {}) {
    for (const url of [`${WEBAPI}/performances/bymonth`, `${CONTENT}/dictionary`]) {
      if (!(await robotsOk(url))) {
        throw new Error(`robots.txt tillåter inte hämtning av ${url}`);
      }
    }

    // Salarnas namn ligger i sajtens ordlista, under nycklar som Facility.17.
    // Faller den bort ska evenemangen ändå komma med, utan salsnamn – huset
    // är det besökaren väljer, salen hittar man på plats.
    let ordlista = {};
    try {
      ordlista = await hämtaJson(`${CONTENT}/dictionary`);
    } catch (err) {
      log(`  ordlistan gick inte att hämta, salarna blir namnlösa: ${err.message}`);
    }
    await paus(800);

    const speltillfällen = [];
    for (const månad of månadsnycklar(now, månader)) {
      let dagar;
      try {
        dagar = await hämtaJson(`${WEBAPI}/performances/bymonth?date=${månad}`);
      } catch (err) {
        // En månad som strular ska inte fälla hela källan. Nästa körning
        // försöker igen, och de andra elva månaderna kommer med nu.
        log(`  ${månad} gick inte att hämta: ${err.message}`);
        continue;
      }

      const rader = flattenMonth(dagar);
      speltillfällen.push(...rader);
      log(`  ${månad}: ${rader.length} speltillfällen`);
      await paus(800);
    }

    if (!speltillfällen.length) {
      throw new Error('inga speltillfällen alls på tolv månader – API:et kan ha ändrats');
    }

    const innehåll = await productionContent(
      [...new Set(speltillfällen.map((p) => p.productionId))],
      { hämtaJson, paus, log },
    );

    const ut = [];
    for (const p of speltillfällen) {
      const rad = toRow(p, { innehåll, ordlista });
      if (rad) ut.push(rad);
    }

    // Utan namn blir raden oanvändbar, och saknas namnet för nästan allt är
    // det innehålls-API:et som har ändrats – inte ett tomt spelår.
    if (ut.length < speltillfällen.length * 0.5) {
      throw new Error(`bara ${ut.length} av ${speltillfällen.length} speltillfällen fick innehåll`);
    }

    log(`  ${ut.length} föreställningar, ${Object.keys(innehåll).length} uppsättningar`);
    return ut;
  },
};

/**
 * Månadsnycklarna API:et vill ha, från innevarande månad och framåt.
 *
 * Formen är ÅÅÅÅ-MM-01, och månaden räknas i Stockholm. Den 1 januari klockan
 * 00:30 svensk tid är det fortfarande december i UTC, och då skulle svepet
 * börja i en månad som redan är slut.
 */
export function månadsnycklar(now = new Date(), antal = MÅNADER) {
  const [år, månad] = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit',
  }).format(now).split('-').map(Number);

  return Array.from({ length: antal }, (_, i) => {
    const d = new Date(Date.UTC(år, månad - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  });
}

/** Månadssvarets dagar till en rak lista av speltillfällen. */
export function flattenMonth(dagar) {
  return toArray(dagar)
    .flatMap((dag) => toArray(dag?.performances))
    .filter((p) => p && p.performanceId && p.performanceDate);
}

/** Uppsättningarnas redaktionella innehåll, hämtat i klumpar. */
export async function productionContent(ids, { hämtaJson = fetchJson, paus = sleep, log = () => {} } = {}) {
  const ut = {};

  for (let i = 0; i < ids.length; i += KLUMP) {
    const klump = ids.slice(i, i + KLUMP);
    const fråga = klump.map((id) => `productionIds=${encodeURIComponent(id)}`).join('&');
    try {
      Object.assign(ut, await hämtaJson(`${CONTENT}/productions/content?${fråga}`));
    } catch (err) {
      log(`  innehåll för ${klump.length} uppsättningar uteblev: ${err.message}`);
    }
    if (i + KLUMP < ids.length) await paus(800);
  }
  return ut;
}

// Operan ger INTE premiärdatum, och det är utrett och inte antaget.
//
// /productions?productionIds=... svarar med firstPerformanceDate, som ser ut
// att vara premiären men är första *kommande* föreställningen: för Tosca gav
// den 2026-09-21, exakt samma datum som nästa speltillfälle. Fältet hade
// alltså duplicerat starts_at under ett namn som påstår något annat, och en
// recensionsmatchning byggd på det hade letat i fel vecka.
//
// Uppsättningarnas innehålls-API bär inget premiärfält heller. premiere_at
// blir därför null för Operan, vilket är sant. Dramaten och Kulturhuset ger
// riktiga premiärdatum - se deras adaptrar.
/**
 * Ett speltillfälle plus sin uppsättning till en rad.
 *
 * external_id är performanceId och inte produktionens id: Tosca spelas tolv
 * kvällar, och med produktionens id hade elva av dem skrivit över varandra i
 * upserten. Samma fälla som Dramaten och Konserthuset har.
 */
export function toRow(p, { innehåll = {}, ordlista = {} } = {}) {
  const prod = innehåll[String(p?.productionId)];
  const title = clean(prod?.name);
  const starts_at = parseDateTime(p?.performanceDate);
  if (!title || !starts_at) return null;

  const genrer = toArray(prod?.genres).map((g) => clean(g)).filter(Boolean);

  return {
    external_id: String(p.performanceId),
    url: prod?.url ? new URL(prod.url, BAS).href : BAS,
    title,
    // Enskilda kvällar kan ha egen text – nypremiär, introduktion före
    // föreställningen. Den är mer exakt än uppsättningens allmänna.
    description: clean(overrideFor(prod, p.performanceId) ?? prod?.description),
    image_url: bildUrl(prod?.listingImageHtml ?? prod?.imageHtml),
    category: categoryFor(genrer),
    genre: genrer.join(', ') || null,
    // Salen står inte i speltillfället utan som en nyckel i sajtens ordlista.
    venue_raw: clean(ordlista[`Facility.${p.facilityId}`]),
    address: 'Gustav Adolfs torg 2, 111 52 Stockholm',
    starts_at,
    ends_at: null,
    // API:et bär availability, alltså antal lediga platser – inte pris.
    price_min: null,
    price_max: null,
    currency: 'SEK',
    // Biljettlänken på sajten pekar på en kassa som kräver att man valt
    // föreställning i deras egen widget. En sådan adress leder besökaren till
    // en tom kundvagn, så vi skickar hellre ingen alls: kortet länkar då till
    // uppsättningens sida, där köpet faktiskt börjar.
    ticket_url: null,
    status: 'scheduled',
    organizer: 'Kungliga Operan',
    raw: p,
  };
}

/** Kvällens egen text, om uppsättningen har en för just det speltillfället. */
function overrideFor(prod, performanceId) {
  const träff = toArray(prod?.performanceOverrides)
    .find((o) => o && o.performanceId === performanceId);
  return träff?.description ?? null;
}

/** Vår kategori ur husets genrelista. */
export function categoryFor(genrer) {
  const text = toArray(genrer).join(' ');

  for (const [mönster, kategori] of KATEGORIER) {
    if (mönster.test(text)) return kategori;
  }
  return 'opera';
}

/**
 * Bilden ur den picture-markup innehålls-API:et skickar.
 *
 * img-taggens src och inte source-elementets srcset: srcset är den stora
 * varianten för breda skärmar, och listan visar en tumnagel.
 */
export function bildUrl(html) {
  const text = String(html ?? '');
  const träff = /<img[^>]*\ssrc="([^"]+)"/.exec(text);
  const src = clean(träff?.[1]);
  if (!src) return null;

  try {
    return new URL(src, BAS).href;
  } catch {
    return null;
  }
}

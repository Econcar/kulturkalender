// Dramaten.
//
// Nivå 2 enligt scanner/sources/_template.mjs: sajten publicerar ingen ld+json
// alls, men lägger hela sidan i Next.js-payloaden __NEXT_DATA__. Den är rikare
// än ld+json hade varit – varje föreställning har eget id, eget datum och egen
// biljettlänk, så en uppsättning ger många rader i stället för en.
//
// Det är skillnaden mot Kulturhuset, som publicerar en pjäs som ETT Event med
// premiären som startDate och derniären som endDate. Här får vi de enskilda
// kvällarna, vilket är det listan faktiskt vill visa.
//
// Hämtningen är två steg: /repertoar ger alla uppsättningar i en enda payload,
// och sedan en sida per uppsättning. Trettioen anrop för hela programmet.
//
// Saknas: pris. Payloaden bär biljettlänk men inget belopp, så price_min och
// price_max blir null. Adaptern gissar inte – se avsnitt 4 i projektstart.md.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime, parseSwedishDate } from '../../lib/event.mjs';
import { clean, first, toArray } from '../../lib/text.mjs';

const BAS = 'https://www.dramaten.se';

// Dramatens egna kategorier är scener och publik, inte genrer: "Stora scenen",
// "Lilla scenen", "Övriga scener", "Barn & unga", "Guidningar",
// "Samtal & Workshops". De säger alltså inget om formen – allt på huset är
// teater om inget annat framgår, och det är därför standardvärdet är 'teater'
// och inte 'övrigt'. Att köra dem genom category() i lib/event.mjs vore fel:
// "Övriga scener" matchar inget mönster där och hade blivit övrigt.
const KATEGORIER = [
  [/barn|unga/i, 'barn'],
  [/samtal|workshop|föreläsning/i, 'föreläsning'],
  [/guidning|visning/i, 'övrigt'],
  [/dans|balett/i, 'dans'],
  [/konsert|musik/i, 'konsert'],
];

export default {
  id: 'dramaten',
  label: 'Dramaten',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(`${BAS}/repertoar`))) {
      throw new Error('robots.txt tillåter inte hämtning av repertoaren');
    }

    const uppsättningar = productionUrls(await hämta(`${BAS}/repertoar`));
    log(`  ${uppsättningar.length} uppsättningar i repertoaren`);
    if (!uppsättningar.length) {
      throw new Error('repertoaren gav inga uppsättningar – payloaden kan ha ändrats');
    }
    await paus(1200);

    const ut = [];
    let utanFöreställning = 0;

    for (const url of uppsättningar) {
      let html;
      try {
        html = await hämta(url);
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
        continue;
      }

      const rader = eventsFromProduction(html, { sourceUrl: url });
      // En uppsättning utan kommande datum är normalt: den är annonserad men
      // inte biljettsläppt, eller nyss spelad färdigt.
      if (!rader.length) utanFöreställning += 1;
      ut.push(...rader);

      await paus(1200);
    }

    log(`  ${ut.length} föreställningar, ${utanFöreställning} uppsättningar utan datum`);
    return ut;
  },
};

/** Adresserna till uppsättningssidorna, ur repertoarens payload. */
export function productionUrls(html) {
  const content = nextContent(html);
  const ut = new Set();

  for (const p of toArray(content?.productions)) {
    const url = clean(p?.url) ?? (p?.slug ? `/repertoar/${p.slug}/` : null);
    if (url) ut.add(new URL(url, BAS).href);
  }
  return [...ut];
}

/**
 * Föreställningarna på en uppsättningssida, en rad per speltillfälle.
 *
 * external_id är föreställningens eget id ur payloaden, inte slugen. Slugen är
 * densamma för alla tolv kvällarna av samma pjäs – hade den använts skulle elva
 * av dem skriva över varandra vid upserten och listan visa en enda.
 */
export function eventsFromProduction(html, { sourceUrl } = {}) {
  const content = nextContent(html);
  if (!content) return [];

  const produktion = content.production ?? {};
  // "Urpremiär 26 november 2026". Fritext och inte ett fält, så den parsas.
  // Premiären är den starkaste signalen för att koppla en recension till en
  // uppsättning - starts_at säger bara när nästa föreställning är, vilket för
  // en pjäs som hade premiär i augusti är något helt annat.
  const premiere_at = parseSwedishDate(content.premiere ?? produktion.premiere);
  const beskrivning = clean(content.listingDescription) ?? clean(content.description);
  const bild = imageFrom(produktion) ?? imageFrom(content);
  const url = sourceUrl ?? (produktion.slug ? `${BAS}/repertoar/${produktion.slug}/` : null);

  const ut = [];
  for (const f of toArray(content.performances)) {
    const starts_at = parseDateTime(f?.startDate);
    const external_id = clean(f?.id);
    const title = clean(f?.title) ?? clean(produktion.title) ?? clean(content.title);
    if (!starts_at || !external_id || !title) continue;

    ut.push({
      external_id,
      url,
      title,
      description: beskrivning,
      image_url: bild,
      category: categoryFor([...toArray(content.categories), ...toArray(produktion.categories)]),
      genre: clean(first(toArray(produktion.categories).map((k) => k?.name))),
      venue_raw: clean(f?.venue?.name) ?? clean(content.location),
      address: 'Nybroplan, Stockholm',
      starts_at,
      ends_at: parseDateTime(f?.endDate),
      premiere_at,
      price_min: null,
      price_max: null,
      currency: 'SEK',
      ticket_url: clean(f?.purchaseUrl),
      status: 'scheduled',
      organizer: 'Dramaten',
      raw: f,
    });
  }
  return ut;
}

/** Vår kategori ur Dramatens scen- och publiketiketter. */
export function categoryFor(categories) {
  const text = toArray(categories)
    .map((k) => clean(typeof k === 'object' ? k?.name : k) ?? '')
    .join(' ');

  for (const [mönster, kategori] of KATEGORIER) {
    if (mönster.test(text)) return kategori;
  }
  return 'teater';
}

/**
 * Payloadens content-objekt.
 *
 * Kastar inte på en sida utan __NEXT_DATA__ – det är anroparens sak att avgöra
 * om en tom sida är ett fel. Repertoaren kräver träff, en enskild uppsättning
 * gör det inte.
 */
export function nextContent(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html ?? ''));
  if (!m) return null;
  try {
    return JSON.parse(m[1])?.props?.pageProps?.content ?? null;
  } catch {
    return null;
  }
}

/** Liggande listbild först – den klär ett kort bättre än en stående affisch. */
function imageFrom(node) {
  for (const kandidat of [node?.listingImage, node?.posterImage]) {
    const url = clean(kandidat?.url);
    if (url) return url;
  }
  return null;
}

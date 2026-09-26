// Showtic: China Teatern, Oscarsteatern och Intiman.
//
// Teatrarnas egna sajter bär inga datum - bara länkar till showtic.se, som
// säljer biljetterna. Showtic är en Next.js-sajt vars knapp "Visa fler" anropar
// ett öppet JSON-API, och det är samma anrop adaptern gör:
//
//   /api/events/venue?venueId=…&limit=100&skip=0   föreställningarna (max 100)
//   /api/shows?limit=100&skip=0                    showerna: slug, genre, ingress
//
// Föreställningen bär exakt tid i UTC ("2026-09-26T18:00:00.000Z", alltså
// 20:00 hos oss - kontrollerat mot China Teaterns egen sida), pris och
// biljettlänk. Genren sitter på showen, inte på föreställningen, så de två
// slås ihop på showens id. Undersökt 2026-09-26; robots.txt stänger inget.
//
// En adapter per hus och inte en för Showtic: en källa ÄR ett hus i den här
// kodbasen (vyerna joinar venues.slug mot events.source), och Showtic säljer
// till fler hus än vi bevakar.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://showtic.se';
const SIDSTORLEK = 100;  // API:et vägrar mer: "limit is greater than 100"
const SANITY = 'https://cdn.sanity.io/images/3553xkck/production';

// Showtics genrer till våra kategorier. Den första genre som finns här avgör,
// huvudgenrerna före de sekundära - "Konsert" med "Show" som sekundär är en
// konsert. Musikal är opera här som i lib/event.mjs.
const GENRE = {
  konsert: 'konsert', julkonsert: 'konsert', 'konsert & klubb': 'konsert', gala: 'konsert',
  musikal: 'opera', musikteater: 'opera',
  komedi: 'humor', 'stand up': 'humor',
  familjeteater: 'barn',
  teater: 'teater', fars: 'teater', buskis: 'teater', show: 'teater', julshow: 'teater',
  'dinner & krogshow': 'teater',
  talkshow: 'föreläsning', 'live podcast': 'föreläsning', ledarskap: 'föreläsning',
};

const STATUS = [
  [/cancel|inställ/i, 'cancelled'],
  [/postpon|uppskj/i, 'postponed'],
];

/** En källa för ett hus hos Showtic. arena är husets slug på showtic.se. */
export function showticKälla({ id, label, arena }) {
  return {
    id,
    label,
    enabled: true,

    async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
      if (!(await robotsOk(`${BAS}/api/events/venue`))) {
        throw new Error('robots.txt tillåter inte Showtics API');
      }

      // Husets id står bara på arenasidan. Det hämtas varje gång i stället för
      // att skrivas in här, så att ett nytt id hos Showtic inte tyst ger noll.
      const venueId = arenaId(await hämta(`${BAS}/arenor/${arena}/`));
      if (!venueId) throw new Error(`hittade inget id på arenasidan för ${arena} - formatet kan ha ändrats`);

      const föreställningar = [];
      for (let skip = 0; skip < 2000; skip += SIDSTORLEK) {
        await paus(1000);
        const sida = JSON.parse(await hämta(`${BAS}/api/events/venue?limit=${SIDSTORLEK}&skip=${skip}&venueId=${venueId}`));
        föreställningar.push(...(sida.data ?? []));
        const totalt = sida.metadata?.total ?? 0;
        if (!sida.data?.length || föreställningar.length >= totalt) break;
      }
      log(`  ${föreställningar.length} föreställningar`);

      // Showerna är utsmyckning: genre, ingress och egen sida. Utan dem blir
      // raderna "övrigt" och länkar till arenasidan, men de finns.
      let shower = new Map();
      try {
        await paus(1000);
        shower = showsById(await hämta(`${BAS}/api/shows?limit=${SIDSTORLEK}&skip=0`));
      } catch (err) {
        log(`  showerna gick inte att hämta: ${err.message}`);
      }

      return föreställningar.map((e) => toRow(e, shower, arena)).filter(Boolean);
    },
  };
}

export default [
  showticKälla({ id: 'chinateatern', label: 'China Teatern', arena: 'china-teatern' }),
  showticKälla({ id: 'oscarsteatern', label: 'Oscarsteatern', arena: 'oscarsteatern' }),
  showticKälla({ id: 'intiman', label: 'Intiman', arena: 'intiman' }),
];

/** Husets id ur arenasidans __NEXT_DATA__. */
export function arenaId(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html ?? ''));
  if (!m) return null;
  try {
    return JSON.parse(m[1])?.props?.pageProps?.venue?._id ?? null;
  } catch {
    return null;
  }
}

/** Showerna per id, med det adaptern behöver. */
export function showsById(json) {
  const karta = new Map();
  let lista;
  try {
    lista = JSON.parse(json)?.data;
  } catch {
    return karta;
  }
  for (const s of lista ?? []) {
    if (!s?._id) continue;
    karta.set(s._id, {
      slug: s.slug?.current ?? null,
      genrer: [...(s.genres ?? []), ...(s.secondaryGenres ?? [])].map((g) => clean(g?.name)).filter(Boolean),
      ingress: typeof s.preamble === 'string' ? clean(s.preamble) : null,
    });
  }
  return karta;
}

/** En föreställning från API:et till en rad. */
export function toRow(e, shower = new Map(), arena = '') {
  const starts_at = parseDateTime(e?.dateAndTime);
  const title = clean(e?.show?.title) ?? clean(String(e?.name ?? '').replace(/^\[([^\]]+)\].*$/, '$1'));
  if (!e?._id || !starts_at || !title) return null;

  const show = shower.get(e.show?._id);
  const pris = e.show?.hideEventPrices ? null : (e.minPrice ?? e.ticketPrice ?? null);

  return {
    url: show?.slug ? `${BAS}/evenemangskalender/${show.slug}` : `${BAS}/arenor/${arena}/`,
    title,
    description: show?.ingress ?? null,
    image_url: sanityBild(e.image?.asset?._ref ?? e.show?.spotImage?.asset?._ref),
    category: kategori(show?.genrer),
    genre: show?.genrer?.[0] ?? null,
    venue_raw: null,
    address: null,
    starts_at,
    ends_at: null,
    premiere_at: null,
    price_min: pris,
    price_max: pris,
    currency: 'SEK',
    ticket_url: e.ticketUrl ?? null,
    status: STATUS.find(([m]) => m.test(e.saleStatus ?? ''))?.[1] ?? 'scheduled',
    organizer: clean(e.promoter?.name) ?? null,
    raw: e,
    // Showtics eget id för föreställningen. Stabilt, och finns alltid.
    external_id: e._id,
  };
}

/** Den första genre vi känner igen, annars övrigt. */
export function kategori(genrer = []) {
  for (const g of genrer) {
    const träff = GENRE[String(g).toLowerCase()];
    if (träff) return träff;
  }
  return 'övrigt';
}

/**
 * Sanitys bildreferens till en adress.
 *
 *   image-7ff03d0a…-1080x1080-jpg  →  …/production/7ff03d0a…-1080x1080.jpg
 */
export function sanityBild(ref) {
  const m = /^image-([a-f0-9]+-\d+x\d+)-([a-z]+)$/.exec(String(ref ?? ''));
  return m ? `${SANITY}/${m[1]}.${m[2]}?w=800` : null;
}

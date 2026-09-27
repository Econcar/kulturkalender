// Nationalmuseum.
//
// Nivå 3: varken ld+json-Event, mikrodata eller API. Men varje
// utställningssida har sitt datumspann överst i sidhuvudet, i ett eget
// element:
//
//   <div class="typo-big-tag showlarge">24 september 2026–7 februari 2027</div>
//
// Titeln står i og:title ("Till havet! | Konstutställning på Nationalmuseum"),
// ingressen i meta description och bilden i ld+json ImageObject. Adresserna
// kommer från /utställningar, som länkar både pågående och kommande.
// Undersökt 2026-09-27; robots.txt stänger ingenting.
//
// Sidor utan datumspann är samlingarna (Tidslinjen, Skattkammaren,
// Designmagasinet) - permanenta, och därför inget att lista i en kalender.
//
// Två grenar hoppas över helt: /på-annan-plats/ är Nationalmuseums
// utställningar på andra museer ("Livet designat" på Jamtli i Östersund), som
// den första körningen tog med som om de gick i Stockholm, och
// /tidigare-utställningar/ är arkivet.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://www.nationalmuseum.se';
const LISTA = `${BAS}/utställningar`;

const MÅNADER = {
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6,
  juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};

export default {
  id: 'nationalmuseum',
  label: 'Nationalmuseum',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
    if (!(await robotsOk(encodeURI(LISTA)))) throw new Error('robots.txt tillåter inte utställningssidorna');

    const adresser = exhibitionUrls(await hämta(encodeURI(LISTA)));
    log(`  ${adresser.length} sidor under /utställningar`);
    if (!adresser.length) throw new Error('listan länkade inga utställningar - formatet kan ha ändrats');

    const ut = [];
    let utanDatum = 0;
    for (const url of adresser) {
      await paus(1200);
      let html;
      try {
        html = await hämta(encodeURI(url));
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
        continue;
      }
      const rad = rowFromPage(html, url);
      if (!rad) { utanDatum += 1; continue; }
      if (new Date(rad.ends_at) >= now) ut.push(rad);
    }
    log(`  ${ut.length} aktuella och kommande, ${utanDatum} utan datum (samlingar)`);
    return ut;
  },
};

/** Utställningssidorna i listan, utan listorna själva. */
export function exhibitionUrls(html) {
  const ut = new Set();
  for (const m of String(html ?? '').matchAll(/href="(https:\/\/www\.nationalmuseum\.se\/utställningar\/[^"#?]+)"/g)) {
    const url = m[1].replace(/\/$/, '');
    if (/\/kommande-utställningar$/.test(url)) continue;
    if (/\/(på-annan-plats|tidigare-utställningar)(\/|$)/.test(url)) continue;
    ut.add(url);
  }
  return [...ut];
}

/** En sida till en rad, eller null om den saknar datumspann. */
export function rowFromPage(html, url) {
  const text = String(html ?? '');
  const spann = parseRange(clean(/class="typo-big-tag[^"]*">([\s\S]*?)<\/div>/.exec(text)?.[1]));
  if (!spann) return null;

  const title = clean(/property="og:title"[^>]*content="([^"]*)"|content="([^"]*)"\s+property="og:title"/.exec(text)?.slice(1).find(Boolean))
    ?.split(' | ')[0];
  if (!title) return null;

  return {
    url,
    title,
    description: clean(/<meta name="description" content="([^"]*)"/.exec(text)?.[1]) ?? null,
    image_url: /"@type":"ImageObject","url":"([^"]+)"/.exec(text)?.[1] ?? huvudbild(text),
    category: 'utställning',
    genre: null,
    venue_raw: null,
    address: null,
    starts_at: spann.starts_at,
    ends_at: spann.ends_at,
    premiere_at: null,
    price_min: null,
    price_max: null,
    currency: 'SEK',
    ticket_url: null,
    status: 'scheduled',
    organizer: 'Nationalmuseum',
    raw: { url },
    external_id: decodeURIComponent(new URL(encodeURI(url)).pathname).split('/').pop(),
  };
}

/**
 * Sidhuvudets bild, när ld+json saknar en. Den är den enda som laddas med
 * fetchpriority="high", och adressen är relativ med mellanslag runt.
 */
function huvudbild(html) {
  const img = /<img[^>]*fetchpriority="high"[^>]*>/.exec(html)?.[0];
  const src = img && /src="\s*([^"\s]+)\s*"/.exec(img)?.[1];
  if (!src) return null;
  return src.startsWith('http') ? src : `${BAS}${src}`;
}

/**
 * "24 september 2026–7 februari 2027" eller "18 mars–15 augusti 2027".
 *
 * Saknas året före strecket är det slutets år - om inte startmånaden ligger
 * efter slutmånaden, för då började utställningen året innan ("5 november–
 * 8 mars 2027"). Slutdagen räknas hela dagen.
 */
export function parseRange(text) {
  const m = /(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{4}))?\s*[–-]\s*(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})/i.exec(String(text ?? ''));
  if (!m) return null;
  const [, d1, mån1, år1, d2, mån2, år2] = m;
  const m1 = MÅNADER[mån1.toLowerCase()];
  const m2 = MÅNADER[mån2.toLowerCase()];
  if (!m1 || !m2) return null;

  const startår = år1 ? Number(år1) : (m1 > m2 ? Number(år2) - 1 : Number(år2));
  const iso = (år, mån, dag) => `${år}-${String(mån).padStart(2, '0')}-${String(dag).padStart(2, '0')}`;
  const starts_at = parseDateTime(iso(startår, m1, d1));
  const slut = parseDateTime(iso(år2, m2, d2));
  if (!starts_at || !slut) return null;
  return { starts_at, ends_at: new Date(new Date(slut).getTime() + 86_400_000 - 60_000).toISOString() };
}

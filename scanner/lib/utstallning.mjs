// En utställningssida till en rad, för konsthallar utan maskinläsbar data.
//
// Bonniers Konsthall och Artipelag (2026-10-03) har samma form: en lista som
// länkar till utställningarna, och på varje sida ett datumspann i klartext -
// "26 aug → 8 nov 2026", "10 okt 2026 – 11 apr 2027". Titel, ingress och bild
// står i Open Graph-taggarna, som båda sätter.
//
// Spannet tas från första stället i sidans text där det står ett. Sidhuvudet
// och menyn bär inga datum hos någon av dem; skulle det ändras är det första
// träffen som blir fel, och testerna för respektive hus visar det.

import { parseDateRange } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

/** Innehållet i en meta-tagg, oavsett ordning på attributen. */
export function meta(html, namn) {
  const text = String(html ?? '');
  const a = new RegExp(`<meta[^>]*(?:property|name)="${namn}"[^>]*content="([^"]*)"`, 'i').exec(text);
  const b = new RegExp(`<meta[^>]*content="([^"]*)"[^>]*(?:property|name)="${namn}"`, 'i').exec(text);
  return clean((a ?? b)?.[1]);
}

/** Sidans synliga text, utan skript och stilar. */
export function synligText(html) {
  return clean(String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')) ?? '';
}

/**
 * En sida till en rad, eller null när sidan saknar datumspann.
 *
 * titelSuffix tas bort ur og:title - husen hänger på sitt eget namn:
 * "De besegrade: Motståndets estetik 2026 - Bonniers Konsthall".
 */
/**
 * Utställningens ingress.
 *
 * og:description i första hand - men flera hus sätter ingen, och några sätter
 * sajtens allmänna text på varje sida ("Tensta konsthall är en plats för
 * samtida konst …"). generisk är de texterna, hämtade ur listsidorna; träffar
 * beskrivningen någon av dem tas i stället första riktiga stycket i
 * innehållet. Stycken om nyhetsbrev och kakor räknas inte.
 */
export function ingress(html, generisk = new Set()) {
  const text = String(html ?? '').replace(/<script[\s\S]*?<\/script>/g, ' ');
  const egen = meta(text, 'og:description') ?? meta(text, 'description');
  if (egen && !generisk.has(egen)) return egen;

  const kandidater = [
    ...[...text.matchAll(/<div class="description">([\s\S]*?)<\/div>/g)].map((m) => m[1]),
    ...[...text.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)].map((m) => m[1]),
  ];
  return kandidater
    .map((k) => clean(k.replace(/<a class="out[\s\S]*$/, '')))
    .find((s) => s && s.length >= 80 && !/nyhetsbrev|prenumerera|cookie|kakor|©/i.test(s)) ?? null;
}

/** Sidans egen beskrivning, för att känna igen den när den står på varje sida. */
export function sajtbeskrivning(html) {
  return meta(html, 'og:description') ?? meta(html, 'description');
}

export function utställningsrad(html, url, { organizer, titelSuffix = null, spann: tolka = parseDateRange, generisk } = {}) {
  const spann = tolka(synligText(html));
  if (!spann) return null;

  let title = meta(html, 'og:title') ?? clean(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(String(html ?? ''))?.[1]);
  if (title && titelSuffix) title = title.replace(titelSuffix, '').trim();
  if (!title) return null;

  return utställning({
    url,
    title,
    description: ingress(html, generisk),
    image_url: meta(html, 'og:image') ?? förstaBild(html, url),
    spann,
    organizer,
  });
}

/**
 * Den första uppladdade bilden i innehållet, för sidor utan og:image.
 * WordPress lägger uppladdningar under /wp-content/uploads/; loggor och ikoner
 * ligger i temat och kommer inte med.
 */
export function förstaBild(html, url) {
  const src = /<img[^>]+(?:data-src|src)="([^"]*\/wp-content\/uploads\/[^"]+\.(?:jpe?g|png|webp))"/i.exec(String(html ?? ''))?.[1];
  if (!src) return null;
  try {
    return new URL(src, url).href;
  } catch {
    return null;
  }
}

/** En rad i tabellens form för en utställning. Delas av sidtolkningen och listtolkningen. */
export function utställning({ url, title, description = null, image_url = null, spann, organizer }) {
  return {
    url,
    title,
    description,
    image_url,
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
    organizer,
    raw: { url },
    external_id: new URL(url).pathname.replace(/^\/|\/$/g, ''),
  };
}

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
export function utställningsrad(html, url, { organizer, titelSuffix = null } = {}) {
  const spann = parseDateRange(synligText(html));
  if (!spann) return null;

  let title = meta(html, 'og:title') ?? clean(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(String(html ?? ''))?.[1]);
  if (title && titelSuffix) title = title.replace(titelSuffix, '').trim();
  if (!title) return null;

  return {
    url,
    title,
    description: meta(html, 'og:description') ?? meta(html, 'description') ?? null,
    image_url: meta(html, 'og:image') ?? null,
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

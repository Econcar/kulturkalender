// Turteatern, Kärrtorp.
//
// WordPress med The Events Calendar, som Liljevalchs: /wp-json/tribe/events/v1
// är öppet och ger varje föreställning med tid i UTC och biljettlänken (hos
// Kulturbiljetter) som website. Undersökt 2026-10-04: tio kvällar Utvandrarna
// 1.0.
//
// Varje kväll är ett eget inlägg med egen adress (/event/utvandrarna-1-0-45/).
// Uppsättningarna grupperas på adress, så med de adresserna hade repertoaren
// visat tio Utvandrarna. Kortet länkar i stället till uppsättningens sida under
// /repertoar/, när titeln hittas där - därifrån kommer också text och bild,
// som kalendern saknar.
//
// Tiden tas ur start_date, inte ur utc_start_date. Sajten har tidszonen satt
// till fast "UTC+2", så UTC-fälten blir en timme fel så fort det är vintertid:
// Utvandrarna 30 oktober klockan 18 stod som 16 UTC, alltså 17 svensk tid.
// Den lokala tiden är den teatern skrev in, och den tolkas som svensk.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { category, parseDateTime } from '../../lib/event.mjs';
import { slugify } from '../../lib/review-match.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://turteatern.se';
const API = `${BAS}/wp-json/tribe/events/v1/events`;

export default {
  id: 'turteatern',
  label: 'Turteatern',
  enabled: true,
  // En fri grupp med en uppsättning i taget och uppehåll mellan dem.
  kanVaraTom: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
    if (!(await robotsOk(API))) throw new Error('robots.txt tillåter inte kalenderns API');

    const idag = now.toISOString().slice(0, 10);
    const poster = [];
    for (let sida = 1; sida <= 10; sida += 1) {
      const svar = JSON.parse(await hämta(`${API}?per_page=50&page=${sida}&start_date=${idag}`));
      poster.push(...(svar.events ?? []));
      if (sida >= (svar.total_pages ?? 1)) break;
      await paus(1000);
    }

    // Uppsättningssidorna, för länk, text och bild. Faller de bort blir det
    // kvällarnas egna adresser i stället - sämre gruppering, inget bortfall.
    const sidor = new Map();
    try {
      await paus(1000);
      for (const url of repertoarsidor(await hämta(`${BAS}/repertoar/`))) sidor.set(url, null);
    } catch (err) {
      log(`  repertoarsidan gick inte att läsa: ${err.message}`);
    }
    for (const url of new Set(poster.map((e) => uppsättningssida(e, [...sidor.keys()])).filter(Boolean))) {
      await paus(1000);
      try {
        sidor.set(url, sidfält(await hämta(url)));
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
      }
    }

    const rader = poster.map((e) => toRow(e, sidor)).filter(Boolean);
    log(`  ${poster.length} kvällar i kalendern`);
    return rader;
  },
};

/** Uppsättningarnas sidor ur /repertoar/. */
export function repertoarsidor(html) {
  return [...new Set([...String(html ?? '').matchAll(/href="(https:\/\/turteatern\.se\/repertoar\/[a-z0-9-]+\/)"/g)].map((m) => m[1]))];
}

/** Sidan vars adress börjar med titeln: "utvandrarna-1-0" → .../utvandrarna-1-0-nypremiar/. */
export function uppsättningssida(e, sidor) {
  const titel = slugify(clean(e?.title));
  if (!titel) return null;
  return sidor.find((u) => {
    const slug = u.split('/').filter(Boolean).pop();
    return slug === titel || slug.startsWith(`${titel}-`);
  }) ?? null;
}

/**
 * Text och bild ur uppsättningssidan, som saknar og-taggar.
 *
 * Bilden är den första uppladdade som inte är loggan (T_vit, TURTEATERN_vit).
 * Texten är det första längre stycket i gemener: sidorna inleds ofta med en
 * ingress i versaler, och den läser sig som ett rop i en lista.
 */
export function sidfält(html) {
  const text = String(html ?? '');
  const bild = [...text.matchAll(/(?:src|data-src)="(https:\/\/turteatern\.se\/wp-content\/uploads\/[^"]+\.(?:jpe?g|png|webp))"/g)]
    .map((m) => m[1])
    .find((u) => !/_vit|logo/i.test(u));
  const stycken = [...text.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => clean(m[1])).filter((s) => s && s.length > 60);
  return {
    description: stycken.find((s) => s !== s.toUpperCase()) ?? stycken[0] ?? null,
    image_url: bild ?? null,
  };
}

/** En kväll ur API:et till en rad. sidor: uppsättningssida → og-fält. */
export function toRow(e, sidor = new Map()) {
  const url = e?.url ?? '';
  if (!url || new URL(url).pathname.startsWith('/en/')) return null;

  const title = clean(e.title);
  // Lokal tid tolkad som svensk - se kommentaren högst upp. UTC-fälten bara
  // när sajtens zon är en riktig zon ("Europe/Stockholm"), inte en fast offset.
  const riktigZon = String(e.timezone ?? '').includes('/');
  const tid = (lokal, utc) => parseDateTime(riktigZon && utc ? `${utc.replace(' ', 'T')}Z` : lokal);
  const starts_at = tid(e.start_date, e.utc_start_date);
  const ends_at = tid(e.end_date, e.utc_end_date);
  if (!title || !starts_at) return null;

  const sida = uppsättningssida(e, [...sidor.keys()]);
  const fält = (sida && sidor.get(sida)) || {};
  const kategorier = (e.categories ?? []).map((k) => clean(k?.name)).filter(Boolean);
  // En teater: det som inte uttryckligen är något annat är teater, inte övrigt.
  const kategori = [title, ...kategorier].map((t) => category({ genre: t })).find((k) => k !== 'övrigt') ?? 'teater';

  return {
    url: sida ?? url,
    title,
    description: clean(e.excerpt) ?? fält.description ?? null,
    image_url: e.image?.url ?? fält.image_url ?? null,
    category: kategori,
    genre: kategorier[0] ?? null,
    venue_raw: clean(e.venue?.venue) ?? null,
    address: null,
    starts_at,
    ends_at: ends_at && ends_at > starts_at ? ends_at : null,
    premiere_at: null,
    price_min: null,
    price_max: null,
    currency: 'SEK',
    ticket_url: e.website || null,
    status: 'scheduled',
    organizer: 'Turteatern',
    raw: e,
    external_id: String(e.id),
  };
}

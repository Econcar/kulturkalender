// Bio Rio.
//
// Nivå 1: varje filmsida (/sv/filmer/<slug>) bär ld+json med en ItemList av
// ScreeningEvent - en per visning, med startDate i UTC, endDate, biljettlänk
// och filmen själv som workPresented (bild, beskrivning, regissör).
// Startsidan länkar till filmerna som går (24 vid undersökningen 2026-10-03);
// /sv/filmer ritas i webbläsaren och sitemapen bär 500 filmer med arkivet.
//
// robots.txt stänger /api/, /_next/ och bokningen - inget av det används.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { extractAllJsonLd } from '../../lib/ldjson.mjs';
import { toEvent } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://www.biorio.se';

export default {
  id: 'biorio',
  label: 'Bio Rio',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(`${BAS}/sv/filmer/`))) throw new Error('robots.txt tillåter inte filmsidorna');

    const filmer = filmUrls(await hämta(`${BAS}/sv`));
    log(`  ${filmer.length} filmer på startsidan`);
    if (!filmer.length) throw new Error('startsidan länkade inga filmer - formatet kan ha ändrats');

    const ut = [];
    for (const url of filmer) {
      await paus(1200);
      try {
        ut.push(...screeningsFromPage(await hämta(url), url));
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
      }
    }
    return ut;
  },
};

export function filmUrls(html) {
  return [...new Set([...String(html ?? '').matchAll(/href="\/sv\/filmer\/([a-z0-9-]+)"/g)].map((m) => `${BAS}/sv/filmer/${m[1]}`))];
}

/** Alla ScreeningEvent på sidan, var de än ligger i ld+json-trädet. */
function visningar(html) {
  const ut = [];
  const gå = (o) => {
    if (Array.isArray(o)) o.forEach(gå);
    else if (o && typeof o === 'object') {
      if (o['@type'] === 'ScreeningEvent') ut.push(o);
      Object.values(o).forEach(gå);
    }
  };
  gå(extractAllJsonLd(html));
  return ut;
}

/**
 * Visningarna på en filmsida.
 *
 * Filmen själv är ett eget block (Movie, med beskrivning och bild) som
 * visningarna pekar på med @id. Visningens eget namn är "Digger - Visning"
 * och dess beskrivning "Se Digger på Bio Rio" - titel och text tas därför
 * från filmen.
 */
export function screeningsFromPage(html, url) {
  const slug = new URL(url).pathname.split('/').pop();
  const filmer = extractAllJsonLd(html).filter((n) => [].concat(n?.['@type']).includes('Movie'));
  return visningar(html).map((v) => {
    const film = filmer.find((f) => f['@id'] && f['@id'] === v.workPresented?.['@id']) ?? v.workPresented ?? {};
    const rad = toEvent({
      ...v,
      name: film.name ?? v.name,
      image: film.image ?? v.image,
      description: film.description ?? v.description,
    }, { sourceUrl: url });
    if (!rad) return null;
    const regi = clean([].concat(film.director ?? []).map((d) => d?.name).filter(Boolean).join(', '));
    return {
      ...rad,
      url,
      description: [regi ? `Regi: ${regi}` : null, rad.description].filter(Boolean).join('. ') || null,
      category: 'film',
      venue_raw: null,
      organizer: 'Bio Rio',
      external_id: `${slug}/${rad.starts_at.slice(0, 16).replace(/[-:T]/g, '')}`,
    };
  }).filter(Boolean);
}

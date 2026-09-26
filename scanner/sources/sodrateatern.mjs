// Södra Teatern.
//
// Nivå 1 enligt scanner/sources/_template.mjs, med en rättelse: varje
// evenemangssida bär ld+json (MusicEvent för musik, generiska Event för humor
// och samtal) med namn, bild, pris och biljettlänk - men startDate är när
// DÖRRARNA öppnar, inte när det börjar. The Proclaimers står som 18:00 i
// blocket, medan sidan säger "Dörrar 18:00, På scen 20:00". Mätt på tre sidor
// 2026-09-26; alla tre hade dörrtiden.
//
// Tiden tas därför ur sidans eget block "Datum & tider", där varje kväll är en
// rad med "Dörrar" och "På scen". Saknas "På scen" används dörrtiden hellre än
// ingenting, och saknas blocket helt faller adaptern tillbaka på ld+json.
//
// Adresserna kommer från WordPress eget API, /wp-json/wp/v2/events, som listar
// alla aktuella evenemang i ett anrop (46 st vid undersökningen). robots.txt
// stänger bara /wp-admin/.
//
// Kategorin tas ur adressen när den säger något. Humorsidorna är generiska
// Event utan genre och hade annars hamnat under "övrigt".

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { eventsFromHtml, parseDateTime, parseSwedishDate } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://sodrateatern.com';
const API = `${BAS}/wp-json/wp/v2/events?per_page=100&_fields=link`;

// Sajtens kategorier i adressen, till våra. "annat" står inte här: där får
// ld+json avgöra, vilket oftast ger övrigt.
const KATEGORI = {
  'musik-show': 'konsert',
  'humor-samtal': 'humor',
};

export default {
  id: 'sodrateatern',
  label: 'Södra Teatern',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(`${BAS}/evenemang/`))) {
      throw new Error('robots.txt tillåter inte hämtning av evenemangssidorna');
    }

    const adresser = eventUrls(await hämta(API));
    log(`  ${adresser.length} evenemangssidor att hämta`);
    if (!adresser.length) throw new Error('API:et listade inga evenemang - formatet kan ha ändrats');

    const ut = [];
    let utanBlock = 0;
    for (const url of adresser) {
      let html;
      try {
        html = await hämta(url);
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
        continue;
      }

      const rader = eventsFromPage(html, url);
      if (!rader.length) utanBlock += 1;
      ut.push(...rader);
      await paus(1200);
    }

    if (adresser.length && utanBlock > adresser.length * 0.8) {
      throw new Error(`${utanBlock} av ${adresser.length} sidor saknade ld+json Event – formatet kan ha ändrats`);
    }
    log(`  ${ut.length} kvällar, ${utanBlock} sidor utan block`);
    return ut;
  },
};

/** Evenemangsadresserna ur WordPress-API:ets svar. */
export function eventUrls(json) {
  let lista;
  try {
    lista = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista
    .map((e) => e?.link)
    .filter((l) => typeof l === 'string' && l.startsWith(`${BAS}/evenemang/`)))];
}

/**
 * En sida till rader, en per kväll.
 *
 * ld+json ger allt utom tiden och rummet. Kvällarna ur "Datum & tider"
 * ersätter startDate; finns bara en kväll blir det en rad med sidans id, finns
 * flera får varje kväll datum och tid i id:t.
 */
export function eventsFromPage(html, url) {
  const [bas] = eventsFromHtml(html, { sourceUrl: url });
  if (!bas) return [];

  const id = externalId(url);
  const kategori = KATEGORI[id.split('/')[0]] ?? bas.category;
  const rum = stage(html);
  const kvällar = showings(html);

  const gemensamt = {
    ...bas,
    category: kategori,
    venue_raw: rum ?? bas.venue_raw,
    // Sluttiden i blocket, om någon, gäller dörrtiden och säger inget om
    // kvällen. Hellre ingen än en som pekar fel.
    ends_at: null,
  };

  if (!kvällar.length) return [{ ...gemensamt, external_id: id }];
  if (kvällar.length === 1) return [{ ...gemensamt, starts_at: kvällar[0], external_id: id }];
  return kvällar.map((starts_at) => ({
    ...gemensamt,
    starts_at,
    external_id: `${id}/${starts_at.slice(0, 16).replace(/[-:T]/g, '')}`,
  }));
}

/**
 * Kvällarna ur blocket "Datum & tider", som ISO i UTC.
 *
 *   <div class="showings"> … <li><div class="date"><span><strong>Söndag 27
 *   september 2026</strong></span></div> <div class="item"><span class="desc">
 *   Dörrar</span><span class="time">18:00</span></div> <div class="item">
 *   <span class="desc">På scen</span><span class="time">20:00</span></div></li>
 */
export function showings(html) {
  const block = /<div class="showings">([\s\S]*?)<\/ul>/.exec(String(html ?? ''));
  if (!block) return [];

  const ut = [];
  for (const [, li] of block[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const datum = parseSwedishDate(text(/<div class="date">([\s\S]*?)<\/div>/.exec(li)?.[1]));
    if (!datum) continue;

    const tider = {};
    for (const [, desc, tid] of li.matchAll(/<span class="desc">([\s\S]*?)<\/span>\s*<span class="time">([\s\S]*?)<\/span>/g)) {
      tider[text(desc).toLowerCase()] = text(tid);
    }
    const tid = tider['på scen'] ?? Object.entries(tider).find(([k]) => k.startsWith('dörrar'))?.[1];
    const klocka = /(\d{1,2})[:.](\d{2})/.exec(tid ?? '');
    if (!klocka) continue;

    const dag = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(datum));
    const starts = parseDateTime(`${dag}T${klocka[1].padStart(2, '0')}:${klocka[2]}`);
    if (starts) ut.push(starts);
  }
  return ut;
}

/** Rummet: "Stora Scen", "Kägelbanan". Står i sidans faktaruta. */
export function stage(html) {
  const m = /<strong>Scen<\/strong>\s*([^<]+)</.exec(String(html ?? ''));
  return m ? clean(m[1]) : null;
}

/** "musik-show/the-proclaimers" - kategori och slug, som hos Kulturhuset. */
export function externalId(url) {
  return new URL(url).pathname.replace(/^\/evenemang\//, '').replace(/\/$/, '');
}

/** Ren text ur ett HTML-utdrag. clean tar både taggar och entiteter. */
function text(html) {
  return clean(html) ?? '';
}

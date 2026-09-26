// Folkoperan.
//
// Varken ld+json, mikrodata eller datum i WordPress-API:et - men sidan
// /kop-biljetter/ listar husets hela program som en serverrenderad lista, en
// rad per föreställning:
//
//   <li class="c-event-list__item"> <h3>Die Stadt ohne Juden</h3>
//   <h4>tisdag 29 september 2026</h4> <span class="u-small-text">19:00</span>
//   … <a href="https://biljetter.folkoperan.se/…/tickets/31671/128964/">
//
// 41 föreställningar fram till nyårsgalan vid undersökningen 2026-09-26, i ett
// anrop. Uppsättningssidorna visar samma lista (hela husets, inte sin egen),
// så det finns inget att vinna på att besöka dem.
//
// Det som saknas i listan hämtas ur WordPress-API:et: uppsättningens egen
// sida (fo_production) och dess bild (media). Tre anrop per natt totalt.
// Pris och beskrivning finns ingenstans i maskinläsbar form och lämnas tomma
// hellre än att tolkas ur fritext.
//
// Biljettsystemet är Tixly. Vi läser aldrig därifrån - bara länken till det,
// som den står på Folkoperans egen sida.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime, parseSwedishDate } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';
import { slugify } from '../../lib/review-match.mjs';

const BAS = 'https://folkoperan.se';
const LISTA = `${BAS}/kop-biljetter/`;
const UPPSÄTTNINGAR = `${BAS}/wp-json/wp/v2/fo_production?per_page=100&_fields=title,link,featured_media`;
const MEDIA = `${BAS}/wp-json/wp/v2/media?per_page=100&_fields=id,source_url&include=`;

// Folkoperan är ett operahus, men foajékonserter, jazzfestival och galor går
// på samma lista. Titeln är det enda som skiljer dem åt.
const KONSERT = /jazz|big band|konsert|trio|tango|spoken word|gala|live|club of gore/i;

export default {
  id: 'folkoperan',
  label: 'Folkoperan',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(LISTA))) {
      throw new Error('robots.txt tillåter inte hämtning av biljettsidan');
    }

    const föreställningar = performances(await hämta(LISTA));
    log(`  ${föreställningar.length} föreställningar på biljettsidan`);
    if (!föreställningar.length) throw new Error('biljettsidan listade inga föreställningar - formatet kan ha ändrats');

    // Uppsättningarna och bilderna är utsmyckning. Faller de bort visas
    // föreställningarna ändå, med biljettsidan som länk och utan bild.
    let uppsättningar = [];
    let bilder = new Map();
    try {
      await paus(1200);
      uppsättningar = productions(await hämta(UPPSÄTTNINGAR));
      const idn = [...new Set(uppsättningar.map((p) => p.media).filter(Boolean))];
      if (idn.length) {
        await paus(1200);
        bilder = media(await hämta(`${MEDIA}${idn.join(',')}`));
      }
    } catch (err) {
      log(`  uppsättningarna gick inte att hämta: ${err.message}`);
    }

    return toRows(föreställningar, uppsättningar, bilder);
  },
};

/** Föreställningarna ur biljettsidans lista, tolkade men inte sammanslagna. */
export function performances(html) {
  const ut = [];
  for (const [li] of String(html ?? '').matchAll(/<li class="c-event-list__item"[\s\S]*?<\/li>/g)) {
    const rubrik = clean(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(li)?.[1]);
    const dag = parseSwedishDate(clean(/<h4[^>]*>([\s\S]*?)<\/h4>/.exec(li)?.[1]));
    const klocka = /class="u-small-text">\s*(\d{1,2})[:.](\d{2})/.exec(li);
    if (!rubrik || !dag || !klocka) continue;

    const datum = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(dag));
    const starts_at = parseDateTime(`${datum}T${klocka[1].padStart(2, '0')}:${klocka[2]}`);
    if (!starts_at) continue;

    const premiär = /\s+PREMIÄR\s*$/i.test(rubrik);
    ut.push({
      title: rubrik.replace(/\s+PREMIÄR\s*$/i, '').trim(),
      premiär,
      starts_at,
      ticket_url: /href="(https:\/\/biljetter\.folkoperan\.se\/[^"]+)"/.exec(li)?.[1] ?? null,
      cancelled: /inställ/i.test(clean(li) ?? ''),
    });
  }

  // Sidan har två listor - "kommande" överst och hela programmet under - och
  // de närmaste kvällarna står i båda. 8 av 41 vid undersökningen. Samma titel
  // och tid är samma föreställning; premiärmärket och länken tas från den som
  // har dem.
  const unika = new Map();
  for (const f of ut) {
    const nyckel = `${f.title}|${f.starts_at}`;
    const förra = unika.get(nyckel);
    unika.set(nyckel, förra
      ? { ...förra, premiär: förra.premiär || f.premiär, ticket_url: förra.ticket_url ?? f.ticket_url }
      : f);
  }
  return [...unika.values()];
}

/** Uppsättningarna ur WordPress-API:et: titel, egen sida och bildens id. */
export function productions(json) {
  let lista;
  try {
    lista = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(lista)) return [];
  return lista
    .map((p) => ({ title: clean(p?.title?.rendered), url: p?.link ?? null, media: p?.featured_media || null }))
    .filter((p) => p.title && p.url);
}

/** Bildernas adresser per id. */
export function media(json) {
  const karta = new Map();
  try {
    for (const m of JSON.parse(json)) if (m?.id && m?.source_url) karta.set(m.id, m.source_url);
  } catch {
    // Utan bilder går det ändå.
  }
  return karta;
}

/**
 * Föreställningarna till rader.
 *
 * Uppsättningen hittas på titeln: listan skriver "La Bohème (Folkoperan
 * Talang)" och "Oum – Stockholm Jazz Festival", API:et "La Bohème" och
 * "Oum". Den längsta titel i API:et som listans titel börjar med vinner, så
 * att "Sommarnattens leende" inte hamnar på en uppsättning som bara heter
 * "Sommar".
 *
 * Premiären: står "PREMIÄR" på en av kvällarna får alla kvällar i samma
 * uppsättning det datumet. Det är den signal recensionsmatchningen behöver.
 */
export function toRows(föreställningar, uppsättningar = [], bilder = new Map()) {
  const premiärer = new Map();
  for (const f of föreställningar) {
    if (f.premiär && !premiärer.has(f.title)) premiärer.set(f.title, f.starts_at);
  }

  return föreställningar.map((f) => {
    const p = uppsättningFör(f.title, uppsättningar);
    return {
      url: p?.url ?? LISTA,
      title: f.title,
      description: null,
      image_url: p?.media ? bilder.get(p.media) ?? null : null,
      category: KONSERT.test(f.title) ? 'konsert' : 'opera',
      genre: null,
      venue_raw: null,
      address: null,
      starts_at: f.starts_at,
      ends_at: null,
      premiere_at: premiärer.get(f.title) ?? null,
      price_min: null,
      price_max: null,
      currency: 'SEK',
      ticket_url: f.ticket_url,
      status: f.cancelled ? 'cancelled' : 'scheduled',
      organizer: 'Folkoperan',
      raw: f,
      // Titel och tid, inte biljettens id: länken försvinner när kvällen är
      // utsåld, och då hade samma föreställning fått ett nytt id och legat
      // kvar som en dubblett.
      external_id: `${slugify(f.title)}/${f.starts_at.slice(0, 16).replace(/[-:T]/g, '')}`,
    };
  });
}

function uppsättningFör(titel, uppsättningar) {
  const nål = slugify(titel);
  let bäst = null;
  for (const p of uppsättningar) {
    const s = slugify(p.title);
    if (!s || !(nål === s || nål.startsWith(`${s}-`))) continue;
    if (!bäst || s.length > slugify(bäst.title).length) bäst = p;
  }
  return bäst;
}

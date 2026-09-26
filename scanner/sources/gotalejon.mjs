// Göta Lejon.
//
// Live Nations plattform, byggd i Next.js med app-routern. Varken ld+json
// eller __NEXT_DATA__, men sidan skickar sin data som React Server
// Components-strömmen - self.__next_f.push([1, "…"]) - och i den ligger varje
// evenemang som färdig JSON: id, namn, eventDateUtc, doorTime, showTime,
// genrer, bild, scen och biljettlänk till Ticketmaster.
//
// eventDateUtc är scentiden, inte dörrtiden: Ben Folds har "showTime": "19:30"
// och "eventDateUtc": "2026-12-06T18:30:00Z", alltså 19:30 hos oss.
//
// Startsidan länkar till varje artist (/all-events/…-tickets-ae588) och varje
// artistsida bär sina evenemang. 26 artister vid undersökningen 2026-09-26,
// alltså 27 anrop. /all-events finns inte (404). robots.txt är tom.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { category, parseDateTime } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://www.gotalejon.se';
const HUS = 'Göta Lejon';

// Live Nation skriver engelska genrer. lib/event.mjs känner igen pop, rock,
// jazz och liknande; resten står här. Musikgenrerna först, så att
// "Dance/Electronic" blir konsert och inte dans. Vid första skarpa körningen
// 2026-09-26 var 16 av 35 övrigt, med genrer som Country, Latin och "Arts and
// Culture" - den sista säger ingenting, och där får titeln avgöra.
const EXTRA = [
  [/country|indie|alternative|latin|metal|hip.?hop|r&b|soul|blues|folk|electronic|reggae|world|orchestra|symphon|music of|drummers/i, 'konsert'],
  [/musical|musikal/i, 'opera'],
  [/comedy|komik|stand.?up|humor/i, 'humor'],
  [/family|familj|children|barn/i, 'barn'],
  [/theatre|theater|teater/i, 'teater'],
  [/dance|dans|ballet|balett/i, 'dans'],
];

export default {
  id: 'gotalejon',
  label: 'Göta Lejon',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(`${BAS}/all-events/`))) {
      throw new Error('robots.txt tillåter inte hämtning av evenemangssidorna');
    }

    const artister = artistUrls(await hämta(`${BAS}/`));
    log(`  ${artister.length} artistsidor att hämta`);
    if (!artister.length) throw new Error('startsidan länkade inga artister - formatet kan ha ändrats');

    const perId = new Map();
    let utanData = 0;
    for (const url of artister) {
      await paus(1200);
      let html;
      try {
        html = await hämta(url);
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
        continue;
      }
      const evenemang = eventsFromPage(html);
      if (!evenemang.length) utanData += 1;
      for (const e of evenemang) perId.set(e.id, e);
    }

    if (utanData > artister.length * 0.8) {
      throw new Error(`${utanData} av ${artister.length} artistsidor saknade evenemangsdata - formatet kan ha ändrats`);
    }

    const rader = [...perId.values()].map(toRow).filter(Boolean);
    log(`  ${rader.length} evenemang`);
    return rader;
  },
};

/** Artistsidorna ur startsidan. */
export function artistUrls(html) {
  const ut = new Set();
  for (const m of String(html ?? '').matchAll(/href="(\/all-events\/[a-z0-9-]+-tickets-ae\d+)"/g)) {
    ut.add(`${BAS}${m[1]}`);
  }
  return [...ut];
}

/**
 * RSC-strömmen som en sträng. Varje push är en JSON-kodad sträng; de sätts
 * ihop i ordning, eftersom ett objekt kan vara delat mellan två.
 */
export function rscText(html) {
  let text = '';
  for (const m of String(html ?? '').matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      text += JSON.parse(`"${m[1]}"`);
    } catch {
      // En trasig bit fäller inte resten.
    }
  }
  return text;
}

/**
 * Evenemangen på en sida: varje "events"-array i strömmen, tolkad som JSON,
 * och bara de som spelas på Göta Lejon.
 */
export function eventsFromPage(html) {
  const text = rscText(html);
  const ut = [];
  let i = 0;
  while ((i = text.indexOf('"events":[{', i)) >= 0) {
    const bit = balanserad(text, text.indexOf('[', i));
    i += 10;
    if (!bit) continue;
    let lista;
    try {
      lista = JSON.parse(bit);
    } catch {
      continue;
    }
    for (const e of lista) {
      if (e?.id && !e.isDeleted && e.venue?.name === HUS) ut.push(e);
    }
  }
  // Strömmen bär samma evenemang flera gånger - en gång per komponent som
  // visar det. Id:t avgör.
  return [...new Map(ut.map((e) => [e.id, e])).values()];
}

/** Ett evenemang ur Live Nations data till en rad. */
export function toRow(e) {
  const starts_at = parseDateTime(e?.eventDateUtc);
  const title = clean(e?.localizations?.find((l) => l.cultureName === 'sv-SE')?.name) ?? clean(e?.name);
  if (!starts_at || !title) return null;

  const biljett = (e.tickets ?? []).find((t) => t?.isVisible && t?.ticketUrl) ?? e.tickets?.[0];
  const pris = (v) => (Number(v) > 0 ? Number(v) : null);
  const genrer = (e.genres ?? []).map((g) => clean(g?.name)).filter(Boolean);

  return {
    url: e.url ? `${BAS}${e.url}` : BAS,
    title,
    description: clean(e.eventListingText) ?? clean(e.mainEventInformation) ?? null,
    image_url: e.image || null,
    category: kategori(genrer, title),
    genre: genrer[0] ?? null,
    venue_raw: null,
    address: null,
    starts_at,
    ends_at: null,
    premiere_at: null,
    price_min: pris(biljett?.priceFrom),
    price_max: pris(biljett?.priceTo),
    currency: biljett?.currencyCode ?? 'SEK',
    ticket_url: biljett?.ticketUrl || null,
    status: 'scheduled',
    organizer: clean(e.promoter) ?? null,
    raw: e,
    external_id: String(e.id),
  };
}

/** Genrerna först, via lib/event.mjs och tabellen ovan; titeln sist. */
export function kategori(genrer = [], titel = '') {
  for (const g of genrer) {
    const k = category({ genre: g });
    if (k !== 'övrigt') return k;
    const extra = EXTRA.find(([m]) => m.test(g));
    if (extra) return extra[1];
  }
  return EXTRA.find(([m]) => m.test(titel))?.[1] ?? 'övrigt';
}

/** Från en öppnande klammer till den som stänger den, med strängar i akt. */
function balanserad(text, start) {
  if (start < 0) return null;
  let djup = 0;
  let iSträng = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (iSträng) {
      if (c === '\\') i += 1;
      else if (c === '"') iSträng = false;
      continue;
    }
    if (c === '"') iSträng = true;
    else if (c === '[' || c === '{') djup += 1;
    else if (c === ']' || c === '}') {
      djup -= 1;
      if (djup === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

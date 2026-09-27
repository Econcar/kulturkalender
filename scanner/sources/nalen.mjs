// Nalen.
//
// Next.js med Storyblok. Startsidans __NEXT_DATA__ bär alla konserter som
// artistkort (95 vid undersökningen 2026-09-27): namn, startDate, pris, bild
// och konsertsidans adress.
//
// Men startDate är DÖRRTIDEN, lokal tid: Madison McFerrin står som 19:00 på
// kortet medan konsertsidan säger "Dörrar 19.00, På scen 20.00". Samma fälla
// som Södra Teatern. Konsertsidans egen data har båda, som "entry" och
// "eventStart", plus scen och genre - så varje konsertsida hämtas, och
// kortets tid används bara om sidan inte svarar.
//
// robots.txt stänger bara namngivna robotar (MJ12bot, Baiduspider och andra).

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateTime, parsePrices } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://www.nalen.com';

export default {
  id: 'nalen',
  label: 'Nalen',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
    if (!(await robotsOk(`${BAS}/`))) throw new Error('robots.txt tillåter inte hämtning');

    const kort = cards(await hämta(`${BAS}/`)).filter((k) => !k.starts_at || new Date(k.starts_at) >= new Date(now.getTime() - 86_400_000));
    log(`  ${kort.length} konserter på startsidan`);
    if (!kort.length) throw new Error('startsidan bar inga konserter - formatet kan ha ändrats');

    const ut = [];
    for (const k of kort) {
      await paus(1200);
      let detalj = null;
      try {
        detalj = detail(await hämta(k.url));
      } catch (err) {
        log(`  ${k.url}: ${err.message} - använder kortets tid`);
      }
      const rad = toRow(k, detalj);
      if (rad) ut.push(rad);
    }
    return ut;
  },
};

/** Storyblok-sidans egen data. */
function nextData(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html ?? ''));
  if (!m) return null;
  try {
    return JSON.parse(m[1])?.props?.pageProps ?? null;
  } catch {
    return null;
  }
}

/** Första objektet i trädet som uppfyller villkoret. */
function hitta(o, villkor) {
  if (!o || typeof o !== 'object') return null;
  if (villkor(o)) return o;
  for (const v of Object.values(o)) {
    const träff = hitta(v, villkor);
    if (träff) return träff;
  }
  return null;
}

/** Storyblok-rich text ("artistName") som vanlig text. */
function richText(nod) {
  if (typeof nod === 'string') return nod;
  if (!nod || typeof nod !== 'object') return '';
  return `${nod.text ?? ''}${(nod.content ?? []).map(richText).join(' ')}`;
}

/** Artistkorten på startsidan. */
export function cards(html) {
  const pp = nextData(html);
  const karusell = hitta(pp, (o) => Array.isArray(o.artists) && o.artists.some((a) => a?.component === 'artistCard'));
  const ut = new Map();
  for (const a of karusell?.artists ?? []) {
    const väg = a?.artistPageUrl?.cached_url ?? a?.artistPageUrl?.story?.full_slug;
    if (!väg) continue;
    const url = `${BAS}/${väg.replace(/^\/+|\/+$/g, '')}`;
    ut.set(url, {
      url,
      title: clean(richText(a.artistName)) ?? clean(a.artistPageUrl?.story?.name),
      starts_at: lokal(a.startDate),
      ends_at: lokal(a.endDate),
      price: a.price ?? null,
      image_url: a.image?.filename ?? null,
      sidekick: clean(a.sideKickName),
    });
  }
  return [...ut.values()];
}

/** Konsertsidans kort: dörrar, scentid, scen, genre, biljettlänk. */
export function detail(html) {
  const pp = nextData(html);
  const kort = hitta(pp, (o) => 'eventStart' in o && 'startDate' in o);
  if (!kort) return null;
  return {
    startDate: kort.startDate,
    eventStart: kort.eventStart,
    entry: kort.entry,
    venue: clean(kort.venue),
    genre: clean(kort.genre),
    price: kort.price,
    ticket_url: kort.ticketButtonUrl?.url || kort.ticketButtonUrl?.cached_url || null,
  };
}

/** Kort och sida till en rad. Scentiden från sidan när den finns. */
export function toRow(k, d) {
  let starts_at = k.starts_at;
  const scen = /(\d{1,2})[:.](\d{2})/.exec(d?.eventStart ?? '');
  const dag = /^(\d{4}-\d{2}-\d{2})/.exec(d?.startDate ?? '')?.[1];
  if (scen && dag) starts_at = parseDateTime(`${dag}T${scen[1].padStart(2, '0')}:${scen[2]}`) ?? starts_at;
  if (!starts_at || !k.title) return null;

  const priser = parsePrices(d?.price ?? k.price ?? '');
  const genre = d?.genre && d.genre !== '–' ? d.genre : null;
  // "Restaurangen" som sidekick är Nalens restaurang, inte en konsert på scen.
  const restaurang = /restaurang/i.test(k.sidekick ?? '');

  return {
    url: k.url,
    title: k.title,
    description: null,
    image_url: k.image_url,
    category: restaurang ? 'övrigt' : 'konsert',
    genre,
    venue_raw: d?.venue ?? null,
    address: null,
    starts_at,
    ends_at: k.ends_at && k.ends_at > starts_at ? k.ends_at : null,
    premiere_at: null,
    price_min: priser.length ? Math.min(...priser) : null,
    price_max: priser.length ? Math.max(...priser) : null,
    currency: 'SEK',
    ticket_url: d?.ticket_url ?? null,
    status: 'scheduled',
    organizer: 'Nalen',
    raw: { kort: k, sida: d },
    external_id: new URL(k.url).pathname.replace(/^\/(sv\/)?/, ''),
  };
}

/** "2026-11-27 16:00" - lokal tid, utan zon. */
function lokal(värde) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(värde ?? ''));
  return m ? parseDateTime(`${m[1]}T${m[2]}`) : null;
}

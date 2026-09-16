// Listsidan. Hämtar /api/events och ritar kommande evenemang, dag för dag.
//
// Sidan är publik och har ingen inloggning – det finns inget att logga in på.
// Därför inget session.js, ingen Supabase-klient i webbläsaren, och inget
// tillstånd att hålla reda på utöver de filter som står i adressfältet.

import { fetchEvents, fetchVenues } from '/api.js';
import { dateRange, daysSince, fetched, groupByDay, price, time, today, utdrag, venueLabel } from '/format.js';
import { VERSION } from '/version.js';

// Måste täcka alla värden CATEGORIES i lib/event.mjs kan ge, annars blir en
// kategori osynlig i gränssnittet. tests/kategorier.test.mjs vaktar det.
// Raden skrollar i sidled, så längden är inget problem.
const KATEGORIER = [
  ['', 'Allt'],
  ['konsert', 'Konsert'],
  ['teater', 'Teater'],
  ['opera', 'Opera'],
  ['dans', 'Dans'],
  ['utställning', 'Utställning'],
  ['film', 'Film'],
  ['barn', 'Barn'],
  ['cirkus', 'Cirkus'],
  ['humor', 'Humor'],
  ['litteratur', 'Litteratur'],
  ['föreläsning', 'Föreläsning'],
  ['festival', 'Festival'],
  ['övrigt', 'Övrigt'],
];

/**
 * Datumfiltret.
 *
 * Fem val och inte fler. En kalender frågas mest om tre saker – i kväll, i
 * helgen, den här veckan – och en rad med tolv datumval kostar mer skärm än
 * den ger. Vill man ha en bestämd dag går det redan: listan står i datumordning.
 *
 * Spannen räknas av dateRange() i format.js, som är testad mot veckoskiften.
 */
const PERIODER = [
  ['', 'När som helst'],
  ['idag', 'I dag'],
  ['imorgon', 'I morgon'],
  ['helg', 'I helgen'],
  ['vecka', 'Den här veckan'],
];

const SIDSTORLEK = 60;

const el = {
  search: document.getElementById('search'),
  filters: document.getElementById('filters'),
  dates: document.getElementById('dates'),
  venues: document.getElementById('venues'),
  venuelist: document.getElementById('venuelist'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  more: document.getElementById('more'),
  meta: document.getElementById('meta'),
  freshness: document.getElementById('freshness'),
};

// Filtren ligger i adressfältet och inte i en variabel, så att en filtrerad
// lista går att länka och att bakåtknappen gör det man tror.
const state = läsUrl();
let laddade = [];
let scener = [];

init();

function init() {
  ritaFilter();
  ritaDatum();
  ritaFärskhet();
  el.search.value = state.q;
  el.meta.textContent = `Sidversion ${VERSION}`;

  el.search.addEventListener('input', debounce(() => {
    state.q = el.search.value.trim();
    state.offset = 0;
    skrivUrl();
    hämta({ ersätt: true });
  }, 300));

  el.more.addEventListener('click', () => {
    state.offset += SIDSTORLEK;
    hämta({ ersätt: false });
  });

  // Kommer man tillbaka till fliken efter en stund är listan gammal – ett
  // evenemang kan ha passerat. Hämta om i stället för att visa i går.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Datumraden också: en flik som stått öppen över natten påstår annars
      // att det är i går.
      ritaFärskhet();
      hämta({ ersätt: true, tyst: true });
    }
  });

  window.addEventListener('popstate', () => {
    Object.assign(state, läsUrl());
    el.search.value = state.q;
    ritaFilter();
    ritaDatum();
    ritaScener();
    hämta({ ersätt: true });
  });

  hämta({ ersätt: true });
  hämtaScener();
}

/**
 * Husen vi bevakar, högst upp på sidan.
 *
 * Listan säger lika mycket om vad sidan INTE täcker som om vad den täcker.
 * En besökare som inte hittar sin konsert ska kunna se på en gång att vi inte
 * läser den scenen, i stället för att tro att det inte spelas något.
 */
async function hämtaScener() {
  scener = await fetchVenues();
  ritaScener();
  ritaFärskhet();
}

/**
 * Dagens datum, och när uppgifterna senast hämtades.
 *
 * Tiden kommer från /api/venues och inte från evenemangen i listan: den ska
 * betyda samma sak oavsett vilket filter som är påslaget. Tas den ur den
 * filtrerade listan ändras den när man klickar på en scen, och en rad som
 * hoppar när man filtrerar ser ut att mena något annat än den gör.
 *
 * Den nyaste av husens tider är sidans. Ett hus som slutat svara drar alltså
 * inte ned raden – det felet syns i stället som "inget just nu" i listan över
 * scener strax under.
 */
function ritaFärskhet() {
  const senast = scener
    .map((hus) => hus.last_scan_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  el.freshness.textContent = [today(), senast ? fetched(senast) : ''].filter(Boolean).join(' · ');

  // Skannern går varje natt. Två dygn utan ny hämtning är inte en fördröjning
  // utan något som har gått sönder, och då ska raden sluta se lugn ut.
  if (senast && daysSince(senast) >= 2) el.freshness.dataset.tone = 'warn';
  else delete el.freshness.dataset.tone;
}

function ritaScener() {
  if (!scener.length) {
    el.venues.hidden = true;
    return;
  }
  el.venues.hidden = false;

  const frag = document.createDocumentFragment();
  for (const hus of scener) {
    const knapp = document.createElement('button');
    knapp.type = 'button';
    knapp.className = 'venue';
    knapp.setAttribute('aria-pressed', String(state.venue === hus.slug));

    const namn = document.createElement('span');
    namn.className = 'venuename';
    namn.textContent = hus.name;
    knapp.append(namn);

    const antal = document.createElement('span');
    antal.className = 'venuecount';
    // Noll skrivs ut. Ett hus vars adapter gått sönder ska synas som tomt och
    // inte försvinna ur listan – ett tyst bortfall är svårare att upptäcka.
    antal.textContent = hus.upcoming_count === 0 ? 'inget just nu' : `${hus.upcoming_count}`;
    knapp.append(antal);

    knapp.addEventListener('click', () => {
      state.venue = state.venue === hus.slug ? '' : hus.slug;
      state.offset = 0;
      skrivUrl();
      ritaScener();
      hämta({ ersätt: true });
    });
    frag.append(knapp);
  }
  el.venuelist.replaceChildren(frag);
}

async function hämta({ ersätt, tyst = false } = {}) {
  if (!tyst) sätt(ersätt ? 'Hämtar …' : 'Hämtar fler …');

  if (ersätt) state.offset = 0;

  try {
    // Perioden blir ett datumspann först här. state bär valet ("helg"), inte
    // datumen – annars pekar ett bokmärke från i fredags på förra helgen.
    const { from, to } = dateRange(state.period);
    const data = await fetchEvents({ ...state, from, to }, { limit: SIDSTORLEK });

    laddade = ersätt ? data.events : [...laddade, ...data.events];
    rita(laddade);
    el.more.hidden = data.events.length < SIDSTORLEK;

    if (!laddade.length) {
      sätt(state.q || state.category || state.venue || state.period
        ? 'Inget matchade filtret.'
        : 'Inga evenemang inlagda ännu. Skannern har inte körts.', 'warn');
    } else {
      sätt(`${laddade.length} evenemang`, 'ok');
    }
  } catch (err) {
    // Service workern serverar ett cachat svar när nätet saknas, så hamnar vi
    // här är det antingen första besöket offline eller ett verkligt serverfel.
    // Att säga "kunde inte hämta" och behålla det som redan står på skärmen är
    // ärligare än att tömma listan.
    sätt(`Kunde inte hämta evenemangen: ${err.message}`, 'error');
    if (!laddade.length) el.results.replaceChildren();
  }
}

function rita(events) {
  const frag = document.createDocumentFragment();

  for (const dag of groupByDay(events)) {
    const rubrik = document.createElement('li');
    rubrik.className = 'dayheading';
    rubrik.textContent = dag.heading;
    frag.append(rubrik);

    for (const event of dag.events) frag.append(kort(event));
  }

  el.results.replaceChildren(frag);
}

function kort(event) {
  const li = document.createElement('li');
  li.className = 'card';

  if (event.image_url) {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = event.image_url;
    img.alt = '';
    img.loading = 'lazy';
    // Försvinner bilden hos källan ska kortet krympa, inte visa en trasig ikon.
    img.addEventListener('error', () => img.remove());
    li.append(img);
  }

  const kropp = document.createElement('div');
  kropp.className = 'cardbody';

  const titel = document.createElement('h2');
  const länk = document.createElement('a');
  // Arrangörens egen sida först, biljettköpet som en egen länk nedanför.
  //
  // Tvärtom mot vad avsnitt 7 i docs/projektstart.md sa från början, och skälet
  // är mätt och inte antaget: Konserthusets biljettshop svarar 403 från sin
  // lastbalanserare så fort besökarens kakor för domänen passerar 10 KiB, vilket
  // de gör för vem som helst som varit på sajten några gånger. Med bara
  // biljettlänken på kortet blev sidan då en återvändsgränd – 276 av 295
  // Konserthuset-rader ledde rakt in i en spärrad shop, trots att vi hade
  // evenemangssidans adress hela tiden. Den ligger bakom Cloudflare och klarar
  // 30 KB kakor utan att blinka.
  //
  // Ingen förlust för de andra husen heller: båda länkarna står kvar, och den
  // som vill köpa biljett ser knappen.
  länk.href = event.url || event.ticket_url || '#';
  länk.textContent = event.title;
  länk.rel = 'noopener';
  länk.target = '_blank';
  titel.append(länk);
  kropp.append(titel);

  const rad = [
    time(event.starts_at),
    venueLabel(event.venue, event.stage),
    price(event.price_min, event.price_max, event.currency),
  ].filter(Boolean).join(' · ');
  const fakta = document.createElement('p');
  fakta.className = 'facts';
  fakta.textContent = rad;
  kropp.append(fakta);

  if (event.description) {
    const text = document.createElement('p');
    text.className = 'muted excerpt';
    // Utdrag, inte hela texten. Se avsnitt 7 i docs/projektstart.md.
    text.textContent = utdrag(event.description);
    kropp.append(text);
  }

  if (event.ticket_url && event.ticket_url !== event.url) {
    const biljett = document.createElement('a');
    biljett.className = 'ticket';
    biljett.href = event.ticket_url;
    biljett.textContent = 'Biljetter';
    biljett.rel = 'noopener';
    biljett.target = '_blank';
    kropp.append(biljett);
  }

  if (event.status !== 'scheduled') {
    const flagga = document.createElement('span');
    flagga.className = 'flag';
    flagga.textContent = { cancelled: 'Inställt', postponed: 'Uppskjutet', rescheduled: 'Nytt datum', 'moved-online': 'Digitalt' }[event.status] ?? event.status;
    kropp.append(flagga);
  }

  li.append(kropp);
  return li;
}

function ritaDatum() {
  const frag = document.createDocumentFragment();
  for (const [värde, etikett] of PERIODER) {
    const knapp = document.createElement('button');
    knapp.type = 'button';
    knapp.className = 'chip';
    knapp.textContent = etikett;
    knapp.setAttribute('aria-pressed', String(state.period === värde));
    knapp.addEventListener('click', () => {
      state.period = värde;
      state.offset = 0;
      skrivUrl();
      ritaDatum();
      hämta({ ersätt: true });
    });
    frag.append(knapp);
  }
  el.dates.replaceChildren(frag);
}

function ritaFilter() {
  const frag = document.createDocumentFragment();
  for (const [värde, etikett] of KATEGORIER) {
    const knapp = document.createElement('button');
    knapp.type = 'button';
    knapp.className = 'chip';
    knapp.textContent = etikett;
    knapp.setAttribute('aria-pressed', String(state.category === värde));
    knapp.addEventListener('click', () => {
      state.category = värde;
      state.offset = 0;
      skrivUrl();
      ritaFilter();
      hämta({ ersätt: true });
    });
    frag.append(knapp);
  }
  el.filters.replaceChildren(frag);
}

function läsUrl() {
  const p = new URLSearchParams(location.search);
  const period = p.get('nar') ?? '';
  return {
    category: p.get('kategori') ?? '',
    venue: p.get('scen') ?? '',
    q: p.get('sok') ?? '',
    // Okänd period i adressen ignoreras. Annars skickar en trasig länk ett
    // tomt spann till API:et och sidan ser ut att sakna evenemang.
    period: PERIODER.some(([värde]) => värde === period) ? period : '',
    offset: 0,
  };
}

function skrivUrl() {
  const p = new URLSearchParams();
  if (state.category) p.set('kategori', state.category);
  if (state.venue) p.set('scen', state.venue);
  if (state.q) p.set('sok', state.q);
  if (state.period) p.set('nar', state.period);
  const fråga = p.toString();
  history.replaceState(null, '', fråga ? `?${fråga}` : location.pathname);
}

function sätt(text, ton) {
  el.status.textContent = text;
  if (ton) el.status.dataset.tone = ton;
  else delete el.status.dataset.tone;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

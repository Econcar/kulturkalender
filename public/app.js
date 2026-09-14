// Listsidan. Hämtar /api/events och ritar kommande evenemang, dag för dag.
//
// Sidan är publik och har ingen inloggning – det finns inget att logga in på.
// Därför inget session.js, ingen Supabase-klient i webbläsaren, och inget
// tillstånd att hålla reda på utöver de filter som står i adressfältet.

import { fetchEvents, fetchVenues } from '/api.js';
import { groupByDay, price, time, utdrag, venueLabel } from '/format.js';
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

const SIDSTORLEK = 60;

const el = {
  search: document.getElementById('search'),
  filters: document.getElementById('filters'),
  venues: document.getElementById('venues'),
  venuelist: document.getElementById('venuelist'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  more: document.getElementById('more'),
  meta: document.getElementById('meta'),
};

// Filtren ligger i adressfältet och inte i en variabel, så att en filtrerad
// lista går att länka och att bakåtknappen gör det man tror.
const state = läsUrl();
let laddade = [];
let scener = [];

init();

function init() {
  ritaFilter();
  el.search.value = state.q;
  el.meta.textContent = VERSION;

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
    if (document.visibilityState === 'visible') hämta({ ersätt: true, tyst: true });
  });

  window.addEventListener('popstate', () => {
    Object.assign(state, läsUrl());
    el.search.value = state.q;
    ritaFilter();
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
    const data = await fetchEvents(state, { limit: SIDSTORLEK });

    laddade = ersätt ? data.events : [...laddade, ...data.events];
    rita(laddade);
    el.more.hidden = data.events.length < SIDSTORLEK;

    if (!laddade.length) {
      sätt(state.q || state.category || state.venue
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
  länk.href = event.ticket_url || event.url || '#';
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

  if (event.status !== 'scheduled') {
    const flagga = document.createElement('span');
    flagga.className = 'flag';
    flagga.textContent = { cancelled: 'Inställt', postponed: 'Uppskjutet', rescheduled: 'Nytt datum', 'moved-online': 'Digitalt' }[event.status] ?? event.status;
    kropp.append(flagga);
  }

  li.append(kropp);
  return li;
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
  return {
    category: p.get('kategori') ?? '',
    venue: p.get('scen') ?? '',
    q: p.get('sok') ?? '',
    offset: 0,
  };
}

function skrivUrl() {
  const p = new URLSearchParams();
  if (state.category) p.set('kategori', state.category);
  if (state.venue) p.set('scen', state.venue);
  if (state.q) p.set('sok', state.q);
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

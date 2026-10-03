// Listsidan. Hämtar /api/events och ritar kommande evenemang, dag för dag.
//
// Sidan är publik och har ingen inloggning – det finns inget att logga in på.
// Därför inget session.js, ingen Supabase-klient i webbläsaren, och inget
// tillstånd att hålla reda på utöver de filter som står i adressfältet.

import { fetchEvents, fetchNews, fetchProductions, fetchReviews, fetchVenues } from '/api.js';
import { dateRange, dayHeading, daysSince, delning, fetched, kalenderfil, kalenderfilnamn, filtreraNytt, groupByDay, price, productionKey, recensionerPerUppsättning, recensionsetikett, runLabel, speltid, time, today, utdrag, venueLabel } from '/format.js';
import { initDrift } from '/drift.js';
import { VERSION } from '/version.js';

// Måste täcka alla värden CATEGORIES i lib/event.mjs kan ge, annars blir en
// kategori osynlig i gränssnittet. tests/kategorier.test.mjs vaktar det.
// Raden skrollar i sidled, så längden är inget problem.
const KATEGORIER = [
  ['', 'Allt'],
  ['konsert', 'Konsert'],
  ['teater', 'Teater'],
  ['opera', 'Opera'],
  ['musikal', 'Musikal'],
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

/**
 * De två sätten att läsa en kalender.
 *
 * "Vad händer i kväll?" och "vad spelar Dramaten?" är olika frågor, och den
 * dag-för-dag-sorterade listan kan bara svara på den första: Dramatens Amnesi
 * ligger i den som sextio rader utspridda över fyra månader. Repertoarvyn slår
 * ihop dem till en och visar speltiden i stället.
 */
const VYER = [
  ['', 'Dag för dag'],
  ['repertoar', 'Repertoar'],
  ['nytt', 'Nytt'],
  ['recensioner', 'Recensioner'],
];

const SIDSTORLEK = 60;

const el = {
  search: document.getElementById('search'),
  filters: document.getElementById('filters'),
  dates: document.getElementById('dates'),
  views: document.getElementById('views'),
  venues: document.getElementById('venues'),
  venuelist: document.getElementById('venuelist'),
  venueshead: document.getElementById('venueshead'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  more: document.getElementById('more'),
  meta: document.getElementById('meta'),
  freshness: document.getElementById('freshness'),
  drift: document.getElementById('drift'),
  rescan: document.getElementById('rescan'),
  driftstatus: document.getElementById('driftstatus'),
  driftnyckel: document.getElementById('driftnyckel'),
};

// Filtren ligger i adressfältet och inte i en variabel, så att en filtrerad
// lista går att länka och att bakåtknappen gör det man tror.
const state = läsUrl();
let laddade = [];
let scener = [];

// Recensionerna hämtas en gång och slås upp per kort. Listan är liten, och
// den väntas in före första ritningen i stället för att korten ritas om när
// den kommer - ett kort som hoppar till under läsning är sämre än 100 ms.
let allaRecensioner = [];
let recensionerPer = new Map();
const recensionerKlara = fetchReviews().then((lista) => {
  allaRecensioner = lista;
  recensionerPer = recensionerPerUppsättning(lista);
});

init();

function init() {
  ritaVyer();
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
    // Från det som faktiskt står i listan, inte en räknare som kan ha gått
    // före ett svar som aldrig ritades.
    state.offset = laddade.length;
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
    ritaVyer();
    ritaFilter();
    ritaDatum();
    ritaScener();
    hämta({ ersätt: true });
  });

  hämta({ ersätt: true });
  hämtaScener();

  registreraSkal();

  // Driftkontrollerna. De visar sig bara för den som har nyckeln, och när ett
  // svep är klart hämtas listan om utan att sidan behöver laddas.
  initDrift({
    rot: el.drift,
    knapp: el.rescan,
    status: el.driftstatus,
    fält: el.driftnyckel,
    onDone: () => {
      hämtaScener();
      hämta({ ersätt: true });
    },
  });
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

  // Den lokala servern läser data/events.json, som bara fylls av npm run
  // scan:local - nattskanningen skriver till databasen, inte till filen. Utan
  // markeringen ser en fyra dagar gammal lokal kopia ut som en trasig skanner.
  const lokalt = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'lokal kopia' : '';

  el.freshness.textContent = [today(), senast ? fetched(senast) : '', lokalt].filter(Boolean).join(' · ');

  // Skannern går varje natt. Två dygn utan ny hämtning är inte en fördröjning
  // utan något som har gått sönder, och då ska raden sluta se lugn ut.
  if (senast && daysSince(senast) >= 2) el.freshness.dataset.tone = 'warn';
  else delete el.freshness.dataset.tone;
}

/**
 * Husen, grupperade och hopfällda.
 *
 * Med fyra hus var en rad knappar rätt. Med 26 blev den en vägg på telefonen
 * som man fick skrolla förbi för att komma till programmet. Nu står husen i
 * grupper under en rubrik som är stängd från början; är ett hus valt står det
 * i rubriken, så att filtret syns också när listan är hopfälld.
 */
const GRUPPER = [
  ['teater', 'Teater'],
  ['musik', 'Musik'],
  ['opera', 'Opera & dans'],
  ['konst', 'Konst'],
  ['film', 'Film'],
];

function ritaScener() {
  if (!scener.length) {
    el.venues.hidden = true;
    return;
  }
  el.venues.hidden = false;

  const vald = scener.find((h) => h.slug === state.venue);
  el.venueshead.replaceChildren(`Scener vi bevakar · ${scener.length}`);
  if (vald) {
    // En knapp och inte bara text: ett valt hus följer med när man byter vy,
    // och med listan hopfälld var det lätt att inte se att filtret var på -
    // "inga recensioner" när det bara var Hovet som inte hade några.
    const markering = document.createElement('button');
    markering.type = 'button';
    markering.className = 'venuechosen';
    markering.textContent = `${vald.name} ✕`;
    markering.setAttribute('aria-label', `Ta bort filtret ${vald.name}`);
    markering.addEventListener('click', (e) => {
      e.preventDefault(); // annars fälls listan ut eller ihop
      state.venue = '';
      state.offset = 0;
      skrivUrl();
      ritaScener();
      hämta({ ersätt: true });
    });
    el.venueshead.append(' · ', markering);
  }

  const grupper = document.createDocumentFragment();
  const kända = new Set(GRUPPER.map(([typ]) => typ));
  for (const [typ, rubrik] of [...GRUPPER, ['', 'Övriga']]) {
    const hus = scener
      .filter((h) => (typ ? h.typ === typ : !kända.has(h.typ)))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    if (!hus.length) continue;

    const grupp = document.createElement('div');
    grupp.className = 'venuegroup';
    const h = document.createElement('h3');
    h.className = 'venuegrouphead';
    h.textContent = rubrik;
    const lista = document.createElement('div');
    lista.className = 'venuelist';
    lista.append(...hus.map(husknapp));
    grupp.append(h, lista);
    grupper.append(grupp);
  }
  el.venuelist.replaceChildren(grupper);
}

function husknapp(hus) {
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
  return knapp;
}

/**
 * Numret på den senaste hämtningen.
 *
 * Svaren kommer inte i den ordning frågorna ställdes. Den som skrev
 * "dramaten" snabbt kunde få svaret på "dra" sist, och då stod det Dramaten i
 * sökrutan och något annat i listan. Bara den senaste hämtningen får rita;
 * de andra kastar sitt svar.
 */
let hämtning = 0;

async function hämta({ ersätt, tyst = false } = {}) {
  const nr = ++hämtning;
  const inaktuell = () => nr !== hämtning;

  if (!tyst) sätt(ersätt ? 'Hämtar …' : 'Hämtar fler …');

  if (ersätt) state.offset = 0;
  // Ett andra tryck medan den första sidan hämtas hade frågat efter samma
  // sida en gång till.
  el.more.disabled = true;

  try {
    // Perioden blir ett datumspann först här. state bär valet ("helg"), inte
    // datumen – annars pekar ett bokmärke från i fredags på förra helgen.
    // Datumfiltret gäller inte repertoaren: en uppsättning som spelas i helgen
    // har sin premiär någon annan gång, och att filtrera på premiärdatumet
    // hade svarat på en fråga ingen ställde.
    const { from, to } = state.view === 'repertoar' ? { from: '', to: '' } : dateRange(state.period);

    if (state.view === 'recensioner') {
      await recensionerKlara;
      if (inaktuell()) return;
      laddade = ritaRecensioner(allaRecensioner);
      el.more.hidden = true;
      sätt(laddade.length
        ? `${laddade.length} ${laddade.length === 1 ? 'recension' : 'recensioner'}`
        : state.category || state.venue
          ? 'Ingen recension matchar filtret.'
          : 'Inga recensioner ännu.', laddade.length ? 'ok' : 'warn');
      if (!laddade.length) visaAllaKnapp();
      return;
    }

    if (state.view === 'nytt') {
      const nyheter = await fetchNews();
      if (inaktuell()) return;
      laddade = ritaNytt(nyheter);
      el.more.hidden = true;
      sätt(laddade.length
        ? `${laddade.length} nyheter de senaste ${nyheter.days} dagarna`
        : state.category || state.venue
          ? `Inget nytt som matchar filtret de senaste ${nyheter.days} dagarna.`
          : `Inget nytt de senaste ${nyheter.days} dagarna.`, laddade.length ? 'ok' : 'warn');
      if (!laddade.length) visaAllaKnapp();
      return;
    }

    const data = state.view === 'repertoar'
      ? await fetchProductions({ ...state }, { limit: SIDSTORLEK })
      : await fetchEvents({ ...state, from, to }, { limit: SIDSTORLEK });

    await recensionerKlara;
    if (inaktuell()) return;

    const nya = state.view === 'repertoar' ? data.productions : data.events;
    laddade = ersätt ? nya : [...laddade, ...nya];

    if (state.view === 'repertoar') ritaRepertoar(laddade);
    else rita(laddade);

    el.more.hidden = nya.length < SIDSTORLEK;

    if (!laddade.length) {
      sätt(state.q || state.category || state.venue || state.period
        ? 'Inget matchade filtret.'
        : 'Inga evenemang inlagda ännu. Skannern har inte körts.', 'warn');
      visaAllaKnapp();
    } else {
      sätt(`${laddade.length} ${state.view === 'repertoar' ? 'uppsättningar' : 'evenemang'}`, 'ok');
    }
  } catch (err) {
    if (inaktuell()) return;
    // Service workern serverar ett cachat svar när nätet saknas, så hamnar vi
    // här är det antingen första besöket offline eller ett verkligt serverfel.
    // Att säga "kunde inte hämta" och behålla det som redan står på skärmen är
    // ärligare än att tömma listan.
    sätt(`Kunde inte hämta evenemangen: ${err.message}`, 'error');
    if (!laddade.length) el.results.replaceChildren();
  } finally {
    if (!inaktuell()) el.more.disabled = false;
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

  // Klockslaget säger ingenting för något som pågår i veckor: en utställning
  // har öppettider, inte en starttid, och för det som redan har börjat är
  // tiden en dag som passerat. Speltiden på raden under säger det som behövs.
  const spann = speltid(event);
  const utanTid = spann && (event.category === 'utställning' || new Date(event.starts_at) < new Date());

  const rad = [
    utanTid ? null : time(event.starts_at),
    venueLabel(event.venue, event.stage),
    price(event.price_min, event.price_max, event.currency),
  ].filter(Boolean).join(' · ');
  const fakta = document.createElement('p');
  fakta.className = 'facts';
  fakta.textContent = rad;
  kropp.append(fakta);

  if (spann) {
    const period = document.createElement('p');
    period.className = 'facts';
    period.textContent = spann;
    kropp.append(period);
  }

  const recenserad = recensionsrad(productionKey(event));
  if (recenserad) kropp.append(recenserad);

  if (event.description) {
    const text = document.createElement('p');
    text.className = 'muted excerpt';
    // Utdrag, inte hela texten. Se avsnitt 7 i docs/projektstart.md.
    text.textContent = utdrag(event.description);
    kropp.append(text);
  }

  // Biljetter, kalender och delning på en rad - det man gör när man har
  // hittat något.
  const knappar = document.createElement('div');
  knappar.className = 'kortknappar';

  if (event.ticket_url && event.ticket_url !== event.url) {
    const biljett = document.createElement('a');
    biljett.className = 'ticket';
    biljett.href = event.ticket_url;
    biljett.textContent = 'Biljetter';
    biljett.rel = 'noopener';
    biljett.target = '_blank';
    knappar.append(biljett);
  }

  const ics = event.status === 'cancelled' ? null : kalenderfil(event);
  if (ics) knappar.append(kalenderknapp(event, ics));
  knappar.append(delaknapp(event));

  kropp.append(knappar);

  if (event.status !== 'scheduled') {
    const flagga = document.createElement('span');
    flagga.className = 'flag';
    flagga.textContent = { cancelled: 'Inställt', postponed: 'Uppskjutet', rescheduled: 'Nytt datum', 'moved-online': 'Digitalt' }[event.status] ?? event.status;
    kropp.append(flagga);
  }

  li.append(kropp);
  return li;
}

function ritaVyer() {
  const frag = document.createDocumentFragment();
  for (const [värde, etikett] of VYER) {
    const knapp = document.createElement('button');
    knapp.type = 'button';
    knapp.className = 'chip';
    knapp.textContent = etikett;
    knapp.setAttribute('aria-pressed', String(state.view === värde));
    knapp.addEventListener('click', () => {
      if (state.view === värde) return;
      state.view = värde;
      state.offset = 0;
      skrivUrl();
      ritaVyer();
      ritaDatum();
      hämta({ ersätt: true });
    });
    frag.append(knapp);
  }
  el.views.replaceChildren(frag);

  // Filter som inte betyder något i vyn göms hellre än visas döda. Datum hör
  // inte till repertoaren, och nyhets- och recensionsvyn tar scen och
  // kategori men inte datum eller sökning - listorna är korta nog att läsa.
  el.dates.hidden = state.view !== '';
  el.search.hidden = state.view === 'nytt' || state.view === 'recensioner';
}

/**
 * Nyheterna: nya uppsättningar och nya recensioner.
 *
 * Scen- och kategorifiltret gäller här också, men filtreras i webbläsaren -
 * ändpunkten tar inga parametrar med flit, så att flödena hämtas som mest två
 * gånger i timmen oavsett hur många som besöker sidan.
 *
 * Returnerar de ritade posterna, så att statusraden kan räkna dem.
 */
function ritaNytt(nyheter) {
  const { productions: nya, reviews: rec } = filtreraNytt(nyheter, state);

  const frag = document.createDocumentFragment();

  if (rec.length) {
    frag.append(rubrik('Recenserat'));
    for (const r of rec) frag.append(recensionskort(r));
  }

  if (nya.length) {
    frag.append(rubrik('Nytt på scenerna'));
    for (const p of nya) frag.append(nyhetskort(p));
  }

  el.results.replaceChildren(frag);
  return [...rec, ...nya];
}

function rubrik(text) {
  const li = document.createElement('li');
  li.className = 'dayheading';
  li.textContent = text;
  return li;
}

/**
 * Alla recensioner, grupperade per scen.
 *
 * Svarar på "vilka hus har recenserats, och vad?" - därför rubrik per hus och
 * nyast först under varje. Husen står i bokstavsordning; en ordning efter
 * antal hade flyttat runt dem varje gång en recension tillkom.
 */
function ritaRecensioner(reviews) {
  const { reviews: urval } = filtreraNytt({ reviews }, state);

  const perHus = new Map();
  for (const r of urval) {
    const hus = r.production?.venue ?? 'Övriga';
    if (!perHus.has(hus)) perHus.set(hus, []);
    perHus.get(hus).push(r);
  }

  const frag = document.createDocumentFragment();
  for (const hus of [...perHus.keys()].sort((a, b) => a.localeCompare(b, 'sv'))) {
    const lista = perHus.get(hus);
    frag.append(rubrik(`${hus} · ${lista.length} ${lista.length === 1 ? 'recension' : 'recensioner'}`));
    for (const r of lista) frag.append(recensionskort(r));
  }

  el.results.replaceChildren(frag);
  return urval;
}

/** En recension: vem som skrev, om vad, och en länk dit. */
function recensionskort(r) {
  const li = document.createElement('li');
  li.className = 'card';

  const kropp = document.createElement('div');
  kropp.className = 'cardbody';

  const titel = document.createElement('h2');
  const länk = document.createElement('a');
  länk.href = r.url;
  länk.rel = 'noopener';
  länk.target = '_blank';
  länk.textContent = r.title ?? 'Recension';
  titel.append(länk);
  kropp.append(titel);

  // Uppsättningen som länk när scenen fortfarande har en sida för den, så att
  // steget från "vad tyckte kritikern?" till "när går den?" är ett klick.
  const fakta = document.createElement('p');
  fakta.className = 'facts';
  const delar = [r.publisher, r.production?.title ? 'om' : null];
  fakta.append(delar.filter(Boolean).join(' · ') + (r.production?.title ? ' ' : ''));
  if (r.production?.title) {
    if (r.production.url) {
      const pjäs = document.createElement('a');
      pjäs.href = r.production.url;
      pjäs.rel = 'noopener';
      pjäs.target = '_blank';
      pjäs.textContent = r.production.title;
      fakta.append(pjäs);
    } else {
      fakta.append(r.production.title);
    }
    if (r.production.venue) fakta.append(` på ${r.production.venue}`);
  }
  if (r.published) fakta.append(` · ${dayHeading(new Date(r.published).toISOString())}`);
  kropp.append(fakta);

  if (r.description) {
    const text = document.createElement('p');
    text.className = 'muted excerpt';
    // Tidningens egen ingress. Aldrig artikeltexten - se avsnitt 7b.
    text.textContent = utdrag(r.description);
    kropp.append(text);
  }

  li.append(kropp);
  return li;
}

/** En uppsättning som dykt upp hos oss sedan sist. */
function nyhetskort(p) {
  const li = uppsättning(p);
  const kropp = li.querySelector('.cardbody');
  const fakta = kropp?.querySelector('.facts');

  if (fakta && p.announced_at) {
    const när = document.createElement('span');
    när.className = 'flag';
    när.textContent = `Ny ${dayHeading(p.announced_at).toLowerCase()}`;
    fakta.after(när);
  }
  return li;
}

/** En rad per uppsättning, med speltiden i stället för ett klockslag. */
function ritaRepertoar(productions) {
  const frag = document.createDocumentFragment();
  let hus = null;

  for (const p of productions) {
    // Rubrik per hus, så att "vad spelar Dramaten?" går att läsa som ett svar
    // även när alla scener visas samtidigt.
    if (p.venue !== hus) {
      hus = p.venue;
      const rubrik = document.createElement('li');
      rubrik.className = 'dayheading';
      rubrik.textContent = hus ?? 'Övriga';
      frag.append(rubrik);
    }
    frag.append(uppsättning(p));
  }

  el.results.replaceChildren(frag);
}

function uppsättning(p) {
  const li = document.createElement('li');
  li.className = 'card';

  if (p.image_url) {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = p.image_url;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    li.append(img);
  }

  const kropp = document.createElement('div');
  kropp.className = 'cardbody';

  const titel = document.createElement('h2');
  const länk = document.createElement('a');
  länk.href = p.url ?? '#';
  länk.textContent = p.title;
  länk.rel = 'noopener';
  länk.target = '_blank';
  titel.append(länk);
  kropp.append(titel);

  const fakta = document.createElement('p');
  fakta.className = 'facts';
  fakta.textContent = [
    runLabel(p.first_at, p.last_at, p.performances),
    p.stages > 1 ? `${p.stages} scener` : null,
    price(p.price_min, p.price_max, 'SEK'),
  ].filter(Boolean).join(' · ');
  kropp.append(fakta);

  const recenserad = recensionsrad(p.production_key);
  if (recenserad) kropp.append(recenserad);

  if (p.description) {
    const text = document.createElement('p');
    text.className = 'muted excerpt';
    text.textContent = utdrag(p.description);
    kropp.append(text);
  }

  // Dela fungerar för hela uppsättningen. Kalendern bara när det finns en
  // enda kväll att lägga in - vilken av fyra visningar skulle det annars bli?
  const som = {
    source: p.source,
    external_id: p.production_key,
    title: p.title,
    venue: p.venue,
    category: p.category,
    starts_at: p.first_at,
    ends_at: p.last_at,
    url: p.url,
  };
  const knappar = document.createElement('div');
  knappar.className = 'kortknappar';
  const ics = p.performances === 1 ? kalenderfil(som) : null;
  if (ics) knappar.append(kalenderknapp(som, ics));
  knappar.append(delaknapp(som));
  kropp.append(knappar);

  li.append(kropp);
  return li;
}

/**
 * "Recenserad i Aftonbladet 17 september: ÅSA LINDERBORG ser en obegripligt
 * svag Parzival på Dramaten" - en rad per recension.
 *
 * Ingressen och inte rubriken. Kulturrubriker säger sällan vad kritikern
 * tyckte ("Kungen med jättepungen är den enda behållningen"), medan ingressen
 * ofta gör det i klartext. Den är tidningens egen sammanfattning, inte
 * kritikerns text - se avsnitt 7b.
 */
function recensionsrad(nyckel) {
  const lista = nyckel ? recensionerPer.get(nyckel) : null;
  if (!lista?.length) return null;

  const block = document.createElement('div');
  block.className = 'reviewed';
  for (const r of lista) {
    const rad = document.createElement('p');
    rad.className = 'facts';
    rad.append('Recenserad i ');
    const länk = document.createElement('a');
    länk.href = r.url;
    länk.rel = 'noopener';
    länk.target = '_blank';
    länk.textContent = recensionsetikett(r);
    if (r.title) länk.title = r.title;
    rad.append(länk);
    if (r.description) {
      const ingress = document.createElement('span');
      ingress.className = 'ingress';
      ingress.textContent = `: ${utdrag(r.description, 140)}`;
      rad.append(ingress);
    }
    block.append(rad);
  }
  return block;
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
  const view = p.get('vy') ?? '';
  return {
    view: VYER.some(([värde]) => värde === view) ? view : '',
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
  if (state.view) p.set('vy', state.view);
  const fråga = p.toString();
  history.replaceState(null, '', fråga ? `?${fråga}` : location.pathname);
}

/**
 * "Lägg i kalendern": kalenderfilen som nedladdning. Telefonen öppnar den i
 * kalendern, datorn sparar den - båda vet vad en .ics är.
 */
function kalenderknapp(event, ics) {
  const knapp = document.createElement('button');
  knapp.type = 'button';
  knapp.className = 'ticket';
  knapp.textContent = 'Lägg i kalendern';
  knapp.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = kalenderfilnamn(event);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  return knapp;
}

/**
 * "Dela": telefonens delningsmeny när den finns. Annars - de flesta datorer -
 * kopieras text och länk, och knappen säger det en stund.
 */
function delaknapp(event) {
  const knapp = document.createElement('button');
  knapp.type = 'button';
  knapp.className = 'ticket';
  knapp.textContent = 'Dela';
  knapp.addEventListener('click', async () => {
    const { title, text, url } = delning(event);
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url: url ?? undefined });
        return;
      }
      await navigator.clipboard.writeText([text, url].filter(Boolean).join('\n'));
      knapp.textContent = 'Kopierat';
    } catch (err) {
      // Avbruten delning är inget fel. Allt annat: säg det, kort.
      if (err?.name === 'AbortError') return;
      knapp.textContent = 'Gick inte att dela';
    }
    setTimeout(() => { knapp.textContent = 'Dela'; }, 2500);
  });
  return knapp;
}

/**
 * "Visa alla" efter ett tomt resultat, när något filter är på. Nollar
 * scen, kategori, period och sökning på en gång.
 */
function visaAllaKnapp() {
  if (!(state.venue || state.category || state.period || state.q)) return;
  const knapp = document.createElement('button');
  knapp.type = 'button';
  knapp.className = 'linkbutton';
  knapp.textContent = 'Visa alla';
  knapp.addEventListener('click', () => {
    Object.assign(state, { venue: '', category: '', period: '', q: '', offset: 0 });
    el.search.value = '';
    skrivUrl();
    ritaScener();
    ritaFilter();
    ritaDatum();
    hämta({ ersätt: true });
  });
  el.status.append(' ', knapp);
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

/**
 * Registrerar service workern.
 *
 * Den har funnits sedan pivoten och aldrig körts: public/sw.js skrevs, testades
 * av tests/version.test.mjs, listades i README som PWA-skal - men ingenting
 * anropade register(). Hela offline-historien var alltså påhittad, och varje
 * versionshöjning "för cachens skull" påverkade ingenting. Att ett test vaktade
 * filen gjorde felet svårare att se, inte lättare: det bevisade att sw.js var
 * konsekvent med sig själv, inte att den användes.
 *
 * Registreringen är tyst om den faller. En sida som fungerar online ska inte
 * visa ett fel om den inte dessutom lyckas fungera offline.
 */
function registreraSkal() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Privat läge, blockerad webbplatsdata, eller osäker anslutning.
      // Listan fungerar ändå - bara inte utan nät.
    });
  });
}

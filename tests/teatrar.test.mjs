// Turteatern, Teater Galeasen och datum utan år, 2026-10-04. Utdragen är
// avskrivna ur riktiga svar och bantade.

import test from 'node:test';
import assert from 'node:assert/strict';

import { datumUtanÅr } from '../lib/event.mjs';
import { föreställningar, startsidansSidor } from '../scanner/sources/galeasen.mjs';
import { sidfält, toRow, uppsättningssida } from '../scanner/sources/turteatern.mjs';

const sv = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

// --- Datum utan år ----------------------------------------------------------

test('året är det första som ger datumet efter gränsen', () => {
  const efter = '2026-08-06T00:00:00Z';
  assert.equal(sv(datumUtanÅr({ dag: '05', månad: 'Oktober', tid: '18.00', efter })), '2026-10-05 18:00:00');
  // Januari ligger efter oktober: nästa år.
  assert.equal(sv(datumUtanÅr({ dag: 14, månad: 'jan', tid: '19:00', efter })), '2027-01-14 19:00:00');
});

test('veckodagen bekräftar året, och fel veckodag ger null i stället för fel år', () => {
  const efter = '2026-08-06T00:00:00Z';
  assert.equal(sv(datumUtanÅr({ veckodag: 'Måndag', dag: 5, månad: 'oktober', tid: '18.00', efter })), '2026-10-05 18:00:00');
  // 5 oktober är en tisdag 2027 och en måndag bara 2026 av de två åren.
  assert.equal(datumUtanÅr({ veckodag: 'onsdag', dag: 5, månad: 'oktober', efter }), null);
  // Förkortat, som Kulturbiljetter skriver: "tor 12 nov".
  assert.equal(sv(datumUtanÅr({ veckodag: 'tor', dag: 12, månad: 'nov', tid: '19.00', efter })), '2026-11-12 19:00:00');
});

test('skräp ger null', () => {
  assert.equal(datumUtanÅr({ dag: 31, månad: 'juni', efter: '2026-01-01T00:00:00Z' }), null);
  assert.equal(datumUtanÅr({ dag: 5, månad: 'oktobr', efter: '2026-01-01T00:00:00Z' }), null);
  assert.equal(datumUtanÅr({ dag: 5, månad: 'oktober', efter: null }), null);
});

// --- Teater Galeasen --------------------------------------------------------

const VERNON = `<html><head>
<link rel="canonical" href="https://galeasen.se/vernonsubutex/" />
<meta property="og:title" content="Vernon Subutex" />
<meta property="og:description" content="F&ouml;rest&auml;llning &ndash; Urpremi&auml;r 5 oktober 2026 L&auml;ngd ca 2,20 h" />
<meta property="og:image" content="https://galeasen.se/wp-content/uploads/2026/06/gal-subutex.jpg" />
</head><body><p>Urpremiär 5 oktober 2026</p>
<a target="_blank" style="color:#FFFFFF;" class="tickets__item" href="https://tickets.nortic.se/ticket/show/350916"> <p class="tickets__name"><span>Måndag 05 Oktober kl&nbsp;18.00</span></p> <p class="tickets__status" style="margin-left: 15px;">Slutsålt</p> <svg class="tickets__arrow"></svg></a>
<a target="_blank" class="tickets__item" href="https://tickets.nortic.se/ticket/show/350917"> <p class="tickets__name"><span>Söndag 18 Oktober kl&nbsp;13.00</span></p> <p class="tickets__status"></p></a>
<a target="_blank" class="tickets__item" href="https://tickets.nortic.se/ticket/show/350918"> <p class="tickets__name"><span>Lördag 14 November kl&nbsp;14.00</span></p> <p class="tickets__status">Inställd</p></a>
</body></html>`;

test('Galeasen: en rad per biljettknapp, året ur premiären', () => {
  const rader = föreställningar(VERNON, { now: new Date('2026-10-04T10:00:00Z') });
  assert.deepEqual(rader.map((r) => sv(r.starts_at)), ['2026-10-05 18:00:00', '2026-10-18 13:00:00', '2026-11-14 14:00:00']);
  const [första] = rader;
  assert.equal(första.title, 'Vernon Subutex');
  assert.equal(första.url, 'https://galeasen.se/vernonsubutex/');
  assert.equal(första.ticket_url, 'https://tickets.nortic.se/ticket/show/350916');
  assert.equal(sv(första.premiere_at), '2026-10-05 00:00:00');
  assert.equal(första.external_id, 'vernonsubutex/202610051600');
  assert.match(första.description, /^Föreställning – Urpremiär/);
});

test('Galeasen: slutsålt är fortfarande en föreställning, inställt är det inte', () => {
  const rader = föreställningar(VERNON, { now: new Date('2026-10-04T10:00:00Z') });
  assert.deepEqual(rader.map((r) => r.status), ['scheduled', 'scheduled', 'cancelled']);
});

test('Galeasen: en sida utan biljettknappar är ingen uppsättning', () => {
  assert.deepEqual(föreställningar('<link rel="canonical" href="https://galeasen.se/historia/" /><meta property="og:title" content="Historia" />'), []);
});

test('Galeasen: startsidans sidor, utan flöde och API', () => {
  const html = '<a href="https://galeasen.se/feed/">f</a><a href="https://galeasen.se/wp-json/">w</a>'
    + '<a href="https://galeasen.se/vernonsubutex/">v</a><a href="http://galeasen.se/historia">h</a><a href="https://galeasen.se/vernonsubutex/">v</a>';
  assert.deepEqual(startsidansSidor(html), ['https://galeasen.se/vernonsubutex/', 'https://galeasen.se/historia/']);
});

// --- Turteatern -------------------------------------------------------------

const KVÄLL = {
  id: 38083,
  title: 'Utvandrarna 1.0',
  url: 'https://turteatern.se/event/utvandrarna-1-0-45/',
  timezone: 'UTC+2',
  start_date: '2026-10-30 18:00:00',
  end_date: '2026-10-30 23:00:00',
  utc_start_date: '2026-10-30 16:00:00',
  utc_end_date: '2026-10-30 21:00:00',
  website: 'https://kulturbiljetter.se/evenemang/8668/utvandrarna-1-0/',
  excerpt: '',
  categories: [],
};
const SIDA = 'https://turteatern.se/repertoar/utvandrarna-1-0-nypremiar/';

test('Turteatern: med fast UTC+2 är den lokala tiden rätt, också efter vintertidens början', () => {
  const rad = toRow(KVÄLL);
  // UTC-fältet hade gett 17:00 - en timme fel efter 25 oktober.
  assert.equal(sv(rad.starts_at), '2026-10-30 18:00:00');
});

test('Turteatern: med en riktig zon används UTC-fälten', () => {
  const rad = toRow({ ...KVÄLL, timezone: 'Europe/Stockholm', utc_start_date: '2026-10-30 17:00:00' });
  assert.equal(sv(rad.starts_at), '2026-10-30 18:00:00');
});

test('Turteatern: kvällarna grupperas på uppsättningens sida, med text och bild därifrån', () => {
  const sidor = new Map([[SIDA, { description: 'Det ligger i den svenska ryggmärgen.', image_url: 'https://turteatern.se/wp-content/uploads/2026/03/x.jpg' }]]);
  const a = toRow(KVÄLL, sidor);
  const b = toRow({ ...KVÄLL, id: 38084, url: 'https://turteatern.se/event/utvandrarna-1-0-46/' }, sidor);
  assert.equal(a.url, SIDA);
  assert.equal(b.url, SIDA);
  assert.notEqual(a.external_id, b.external_id);
  assert.equal(a.description, 'Det ligger i den svenska ryggmärgen.');
  assert.equal(a.category, 'teater');
  assert.equal(a.ticket_url, KVÄLL.website);
});

test('Turteatern: titeln hittar sidan bara som början av adressen', () => {
  const sidor = [SIDA, 'https://turteatern.se/repertoar/gastspel-kiddo/'];
  assert.equal(uppsättningssida(KVÄLL, sidor), SIDA);
  assert.equal(uppsättningssida({ title: 'Kiddo' }, sidor), null);
});

test('Turteatern: bilden är inte loggan, texten inte ingressen i versaler', () => {
  const html = '<img src="https://turteatern.se/wp-content/uploads/2025/09/T_vit-1024x1024.webp">'
    + '<img data-src="https://turteatern.se/wp-content/uploads/2026/03/DSCF8312.jpg">'
    + '<p>DRÖMMER DU FORTFARANDE OM ATT LÄMNA SVERIGE? 2025 GAV TURTEATERN 20 FÖRESTÄLLNINGAR AV UTVANDRARNA.</p>'
    + '<p>Det ligger i den svenska ryggmärgen att hojta till av repliker som horan gav mig löss.</p>';
  const f = sidfält(html);
  assert.equal(f.image_url, 'https://turteatern.se/wp-content/uploads/2026/03/DSCF8312.jpg');
  assert.match(f.description, /^Det ligger/);
});

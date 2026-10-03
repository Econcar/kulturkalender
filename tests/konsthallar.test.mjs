// Mer konst och konsertrecensionerna, 2026-10-03.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDateRange, parseDateTime } from '../lib/event.mjs';
import { matchReviewText } from '../lib/review-match.mjs';
import { passeradeUppsättningar } from '../lib/upcoming.mjs';
import { utställningsrad } from '../scanner/lib/utstallning.mjs';
import { kategori as akademiKategori, rowsFromPage } from '../scanner/sources/konstakademien.mjs';
import { programRader } from '../scanner/sources/modernamuseet.mjs';

const stockholm = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
const NU = new Date('2026-10-03T10:00:00Z');

// --- Konsertrecensioner -----------------------------------------------------

test('en konsert som spelats nyss finns att matcha mot', () => {
  const rad = {
    source: 'fasching', external_id: 'laura-misch-2026-09-27', url: 'https://www.fasching.se/laura-misch-2026-09-27/',
    title: 'Laura Misch', category: 'konsert', starts_at: '2026-09-27T18:00:00Z', status: 'scheduled',
  };
  const [p] = passeradeUppsättningar([rad], { now: NU });
  assert.equal(p.title, 'Laura Misch');
  assert.equal(p.venue_slug, 'fasching');
  // Men inte en från förra månaden.
  assert.equal(passeradeUppsättningar([{ ...rad, starts_at: '2026-08-01T18:00:00Z' }], { now: NU }).length, 0);
});

test('recensionen dagen efter konserten matchar', () => {
  const [p] = passeradeUppsättningar([{
    source: 'fasching', external_id: 'x', url: 'https://www.fasching.se/laura-misch-2026-09-27/',
    title: 'Laura Misch', category: 'konsert', starts_at: '2026-09-27T18:00:00Z', status: 'scheduled',
  }], { now: NU });
  const träff = matchReviewText({
    url: 'https://www.dn.se/kultur/laura-misch-tar-plats-pa-den-lilla-scenen/',
    title: 'Laura Misch blomstrar på Faschings scen',
    description: 'Laura Misch trollbinder publiken med både saxofon och röst.',
    published: '2026-09-28T09:00:00Z',
  }, [p]);
  assert.equal(träff?.production_key, p.production_key);
});

// --- Datum -----------------------------------------------------------------

test('datumspann i husens olika skrivsätt', () => {
  const fall = [
    ['26 aug → 8 nov 2026', '2026-08-26 00:00:00', '2026-11-08 23:59:00'],
    ['10 okt 2026 – 11 apr 2027', '2026-10-10 00:00:00', '2027-04-11 23:59:00'],
    ['24 september 2026–7 februari 2027', '2026-09-24 00:00:00', '2027-02-07 23:59:00'],
    ['5 november–8 mars 2027', '2026-11-05 00:00:00', '2027-03-08 23:59:00'],
  ];
  for (const [text, start, slut] of fall) {
    const r = parseDateRange(text);
    assert.equal(stockholm(r.starts_at), start, text);
    assert.equal(stockholm(r.ends_at), slut, text);
  }
  assert.equal(parseDateRange('Öppet tis–sön 11–17'), null);
});

test('datum utan inledande nolla, som EventON skriver dem', () => {
  assert.equal(stockholm(parseDateTime('2026-10-7T18:00:00')), '2026-10-07 18:00:00');
});

// --- Konsthallarna ----------------------------------------------------------

test('en utställningssida till en rad, utan husets namn i titeln', () => {
  const html = `<html><head>
    <meta property="og:title" content="De besegrade: Motståndets estetik 2026 - Bonniers Konsthall">
    <meta property="og:description" content="En utställning om motstånd.">
    <meta property="og:image" content="https://bonnierskonsthall.se/bild.jpg">
  </head><body><nav>Utställningar Kalender</nav><h1>De besegrade</h1><p>26 aug → 8 nov 2026</p></body></html>`;
  const rad = utställningsrad(html, 'https://bonnierskonsthall.se/utstallning/de-besegrade-motstandets-estetik-2026/', {
    organizer: 'Bonniers Konsthall', titelSuffix: /\s*[-–|]\s*Bonniers Konsthall$/,
  });
  assert.equal(rad.title, 'De besegrade: Motståndets estetik 2026');
  assert.equal(rad.category, 'utställning');
  assert.equal(stockholm(rad.ends_at), '2026-11-08 23:59:00');
  assert.equal(rad.external_id, 'utstallning/de-besegrade-motstandets-estetik-2026');
});

test('en sida utan datumspann blir ingen rad', () => {
  assert.equal(utställningsrad('<meta property="og:title" content="Om oss">', 'https://x.se/om/', {}), null);
});

// --- Konstakademien ---------------------------------------------------------

test('Konstakademien: ld+json med datum utan nolla blir en rad', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'http://schema.org', '@type': 'Event', name: 'Stadens mjuka makt',
    startDate: '2026-10-7T18:00:00', endDate: '2026-10-7T19:00:00',
  })}</script>`;
  const [rad] = rowsFromPage(html, 'https://konstakademien.se/events/stadens-mjuka-makt/');
  assert.equal(stockholm(rad.starts_at), '2026-10-07 18:00:00');
  assert.equal(rad.external_id, 'stadens-mjuka-makt/2026-10-07');
});

test('Konstakademien: utställning, föredrag och verkstad hålls isär', () => {
  assert.equal(akademiKategori('John Huntington', '2026-10-10T10:00:00Z', '2026-11-20T23:00:00Z'), 'utställning');
  assert.equal(akademiKategori('Bonadens bildvärld', '2026-11-25T17:00:00Z', '2026-11-25T18:00:00Z'), 'föreläsning');
  assert.equal(akademiKategori('Teckna kroki med Stina Wollter', '2026-10-14T16:00:00Z', '2026-10-14T18:00:00Z'), 'övrigt');
  assert.equal(akademiKategori('Filmvisning', '2026-10-03T12:00:00Z', '2026-10-03T13:00:00Z'), 'film');
});

// --- Moderna Museets program ------------------------------------------------

test('Moderna Museet: en rad per kommande tillfälle, bara Stockholm och svenska', () => {
  const post = {
    id: 9, lang: 'sv', location: [12], link: 'https://www.modernamuseet.se/sv/stockholm/kalender/konstnarssamtal/',
    title: { rendered: 'Konstnärssamtal med Jan Håfström' },
    meta: { _event_schedules: [
      { start: '2026-09-01T18:00:00', end: '2026-09-01T19:00:00' },
      { start: '2026-10-20T18:00:00', end: '2026-10-20T19:00:00' },
    ] },
  };
  const rader = programRader(post, NU);
  assert.equal(rader.length, 1);
  assert.equal(stockholm(rader[0].starts_at), '2026-10-20 18:00:00');
  assert.equal(rader[0].category, 'föreläsning');
  assert.equal(programRader({ ...post, location: [13] }, NU).length, 0, 'Malmö kom med');
  assert.equal(programRader({ ...post, lang: 'en' }, NU).length, 0);
});

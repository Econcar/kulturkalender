// "Lägg i kalendern" och "Dela" på korten.

import test from 'node:test';
import assert from 'node:assert/strict';

import { delning, kalenderfil, kalenderfilnamn } from '../public/format.js';

const NU = new Date('2026-10-03T10:00:00Z');

const FILM = {
  source: 'cinemateket',
  external_id: '7700/202610041600',
  title: 'Landskap efter striden',
  venue: 'Cinemateket',
  stage: 'Bio Victor',
  starts_at: '2026-10-04T14:00:00Z',
  ends_at: '2026-10-04T16:10:00Z',
  url: 'https://www.filminstitutet.se/film?filmId=7700',
  ticket_url: 'https://bio.se/biografer/filmhuset/20261004/1600/Victor',
};

const UTSTÄLLNING = {
  title: 'Lotta Antonsson',
  venue: 'Fotografiska',
  category: 'utställning',
  starts_at: '2026-04-25T00:00:00Z',
  ends_at: '2026-11-29T00:00:00Z',
  url: 'https://fotografiska.com/sv/stockholm/lotta',
};

const rader = (ics) => ics.split('\r\n');

test('kalenderfil: tider i UTC, rader med CRLF och ett slut på raden', () => {
  const ics = kalenderfil(FILM, NU);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  const r = rader(ics);
  assert.ok(r.includes('DTSTART:20261004T140000Z'));
  assert.ok(r.includes('DTEND:20261004T161000Z'));
  assert.ok(r.includes('DTSTAMP:20261003T100000Z'));
  assert.ok(r.includes('SUMMARY:Landskap efter striden'));
  assert.ok(r.includes('LOCATION:Cinemateket\\, Bio Victor'));
  assert.ok(r.includes('UID:cinemateket-7700/202610041600@kulturkalendern'));
});

test('kalenderfil: utan sluttid antas två timmar', () => {
  const r = rader(kalenderfil({ ...FILM, ends_at: null }, NU));
  assert.ok(r.includes('DTEND:20261004T160000Z'));
});

test('kalenderfil: komma, semikolon, bakstreck och radbrytning skrivs om', () => {
  const ics = kalenderfil({ ...FILM, title: 'A, B; C\\D\nE' }, NU);
  assert.ok(rader(ics).includes('SUMMARY:A\\, B\\; C\\\\D\\nE'));
});

test('kalenderfil: långa rader viks vid 75 byte, även med å, ä och ö', () => {
  const ics = kalenderfil({ ...FILM, description: 'Översättning åäö '.repeat(20) }, NU);
  for (const rad of rader(ics)) assert.ok(Buffer.byteLength(rad, 'utf8') <= 75, rad);
  // Viken rad fortsätter med ett mellanslag och går ihop till samma text.
  const ihop = ics.replace(/\r\n /g, '');
  assert.match(ihop, /DESCRIPTION:Översättning åäö Översättning/);
});

test('kalenderfil: utställningar och sådant utan tid får ingen fil', () => {
  assert.equal(kalenderfil(UTSTÄLLNING, NU), null);
  assert.equal(kalenderfil({ ...FILM, starts_at: null }, NU), null);
  assert.equal(kalenderfil({ ...FILM, title: '' }, NU), null);
});

test('kalenderfilnamn: titeln och datumet, utan konstiga tecken', () => {
  assert.equal(kalenderfilnamn(FILM), 'landskap-efter-striden-2026-10-04.ics');
});

test('delning: alltid datumet, aldrig "i morgon"', () => {
  const d = delning(FILM, NU);
  assert.equal(d.text, 'Landskap efter striden – Cinemateket, Bio Victor, söndag 4 oktober 2026 16:00');
  assert.equal(d.url, FILM.url);
});

test('delning: utställningar delas med speltiden', () => {
  const d = delning(UTSTÄLLNING, NU);
  assert.equal(d.text, 'Lotta Antonsson – Fotografiska, pågår 25 april – 29 november 2026');
});

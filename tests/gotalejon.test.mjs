import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import gotalejon, { artistUrls, eventsFromPage, kategori, toRow } from '../scanner/sources/gotalejon.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ARTIST = readFileSync(join(here, 'fixtures', 'gotalejon-artist.html'), 'utf8');

const stockholm = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

test('evenemanget läses ur strömmen även när det är delat mellan två push-anrop', () => {
  const evenemang = eventsFromPage(ARTIST);
  assert.equal(evenemang.length, 1);
  assert.equal(evenemang[0].id, '1639116');
});

test('bara Göta Lejon, inte samma artist på en annan scen', () => {
  assert.ok(eventsFromPage(ARTIST).every((e) => e.venue.name === 'Göta Lejon'));
});

test('tiden är scentiden i svensk tid', () => {
  // showTime 19:30, eventDateUtc 18:30Z i december.
  const rad = toRow(eventsFromPage(ARTIST)[0]);
  assert.equal(stockholm(rad.starts_at), '2026-12-06 19:30:00');
});

test('raden får svensk titel, biljettlänk, egen sida och kategori ur genren', () => {
  const rad = toRow(eventsFromPage(ARTIST)[0]);
  assert.equal(rad.title, 'Ben Folds: Paper Airplane Request Tour');
  assert.match(rad.ticket_url, /^https:\/\/www\.ticketmaster\.se\//);
  assert.equal(rad.url, 'https://www.gotalejon.se/all-events/ben-folds-tickets-ae588');
  assert.equal(rad.category, 'konsert');
  assert.equal(rad.external_id, '1639116');
  // Pris 0 betyder att det inte står något, inte att det är gratis.
  assert.equal(rad.price_min, null);
});

test('Live Nations genrer och titlar blir våra kategorier', () => {
  assert.equal(kategori(['Country']), 'konsert');
  assert.equal(kategori(['Dance/Electronic']), 'konsert');
  assert.equal(kategori(['Arts and Culture'], 'Djungelboken - The Musical'), 'opera');
  assert.equal(kategori(['Arts and Culture'], 'Georgian National Ballet'), 'dans');
  assert.equal(kategori(['Sport'], 'Arsenal Legends'), 'övrigt');
});

test('artistsidorna ur startsidan, var och en en gång', () => {
  const html = '<a href="/all-events/ben-folds-tickets-ae588">x</a><a href="/all-events/ben-folds-tickets-ae588">y</a><a href="/om">z</a>';
  assert.deepEqual(artistUrls(html), ['https://www.gotalejon.se/all-events/ben-folds-tickets-ae588']);
});

test('hela kedjan utan nät', async () => {
  const rader = await gotalejon.fetchEvents({
    log: () => {},
    paus: async () => {},
    robotsOk: async () => true,
    hämta: async (url) => (url === 'https://www.gotalejon.se/'
      ? '<a href="/all-events/ben-folds-tickets-ae588">Ben Folds</a>'
      : ARTIST),
  });
  assert.equal(rader.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import kulturhuset, { extractEventUrls, externalId } from '../scanner/sources/kulturhuset.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

const KATEGORI = fixture('kulturhuset-kategori.html');
const KONSERT = fixture('kulturhuset-konsert.html');
const ARKIV = fixture('kulturhuset-arkiv.html');

/** Ingen sömn och inget nät i testerna. */
const stubbar = (sidor) => ({
  paus: async () => {},
  robotsOk: async () => true,
  log: () => {},
  hämta: async (url) => {
    if (url in sidor) return sidor[url];
    throw new Error(`404 ${url}`);
  },
});

test('bara tvåledade adresser i rätt kategori plockas upp', () => {
  const urlar = extractEventUrls(KATEGORI, 'konserter');

  assert.deepEqual(urlar, [
    'https://kulturhusetstadsteatern.se/konserter/fatoumata-diawara',
    'https://kulturhusetstadsteatern.se/konserter/bandit-metal-night',
    'https://kulturhusetstadsteatern.se/konserter/natten-jazzen',
    'https://kulturhusetstadsteatern.se/konserter/sjung-handels-messias',
  ]);
});

test('kategorisidan själv, andra kategorier och tre led hålls utanför', () => {
  const urlar = extractEventUrls(KATEGORI, 'konserter');

  assert.ok(!urlar.some((u) => u.endsWith('/konserter')), 'kategorisidan kom med');
  assert.ok(!urlar.some((u) => u.includes('/teater/')), 'annan kategori kom med');
  assert.ok(!urlar.some((u) => u.includes('for-skolan')), 'tre led kom med');
  assert.ok(!urlar.some((u) => u.includes('sergels-torg')), 'sidfotslänk kom med');
});

test('samma länk två gånger ger en adress', () => {
  const urlar = extractEventUrls(KATEGORI, 'konserter');
  assert.equal(new Set(urlar).size, urlar.length);
});

test('id:t är kategori och slug, inte bara slugen', () => {
  // Två kategorier kan ha samma slug. Hela sökvägen är det som är unikt.
  assert.equal(externalId('https://kulturhusetstadsteatern.se/konserter/fatoumata-diawara'),
    'konserter/fatoumata-diawara');
  assert.equal(externalId('https://kulturhusetstadsteatern.se/teater/amadeus/'), 'teater/amadeus');
});

test('en konsert läses hela vägen till en rad', async () => {
  const sidor = {
    'https://kulturhusetstadsteatern.se/konserter': KATEGORI,
    'https://kulturhusetstadsteatern.se/konserter/fatoumata-diawara': KONSERT,
  };
  const rader = await kulturhuset.fetchEvents(stubbar(sidor));

  assert.equal(rader.length, 1);
  const rad = rader[0];
  assert.equal(rad.external_id, 'konserter/fatoumata-diawara');
  assert.equal(rad.title, 'Fatoumata Diawara');
  assert.equal(rad.category, 'konsert');
  assert.equal(rad.starts_at, '2026-10-17T18:00:00.000Z');
  assert.equal(rad.venue_raw, 'Studion, plan 1');
  assert.equal(rad.price_min, 550);
  assert.equal(rad.ticket_url, 'https://tix.kulturhusetstadsteatern.se/sv/buyingflow/tickets/31768/');
});

test('arkivsidor utan starttid ger ingen rad', async () => {
  const sidor = {
    'https://kulturhusetstadsteatern.se/teater': '<a href="/teater/2-meter">2 METER</a>',
    'https://kulturhusetstadsteatern.se/teater/2-meter': ARKIV,
  };
  const rader = await kulturhuset.fetchEvents(stubbar(sidor));

  assert.deepEqual(rader, []);
});

test('en sida som strular hoppas över, resten hämtas', async () => {
  const sidor = {
    'https://kulturhusetstadsteatern.se/konserter': KATEGORI,
    'https://kulturhusetstadsteatern.se/konserter/fatoumata-diawara': KONSERT,
    // De tre övriga saknas i stubben och kastar 404.
  };
  const rader = await kulturhuset.fetchEvents(stubbar(sidor));

  assert.equal(rader.length, 1);
  assert.equal(rader[0].title, 'Fatoumata Diawara');
});

test('en kategorisida som faller bort fäller inte källan', async () => {
  const sidor = {
    'https://kulturhusetstadsteatern.se/konserter': KATEGORI,
    'https://kulturhusetstadsteatern.se/konserter/fatoumata-diawara': KONSERT,
    'https://kulturhusetstadsteatern.se/konserter/bandit-metal-night': KONSERT,
    'https://kulturhusetstadsteatern.se/konserter/natten-jazzen': KONSERT,
    'https://kulturhusetstadsteatern.se/konserter/sjung-handels-messias': KONSERT,
  };
  const rader = await kulturhuset.fetchEvents(stubbar(sidor));
  assert.equal(rader.length, 4);
});

test('nekande robots.txt stoppar hämtningen', async () => {
  await assert.rejects(
    () => kulturhuset.fetchEvents({ ...stubbar({}), robotsOk: async () => false }),
    /robots\.txt/,
  );
});

test('nästan bara sidor utan Event kastar i stället för att tiga', async () => {
  // Skulle sajten lägga om sitt format ska källan gå till error i scan_runs,
  // inte rapportera "0 rader" som om programmet vore tomt den veckan.
  const tomma = Object.fromEntries(
    ['fatoumata-diawara', 'bandit-metal-night', 'natten-jazzen', 'sjung-handels-messias']
      .map((s) => [`https://kulturhusetstadsteatern.se/konserter/${s}`, '<html>inget här</html>']),
  );
  const sidor = { 'https://kulturhusetstadsteatern.se/konserter': KATEGORI, ...tomma };

  await assert.rejects(() => kulturhuset.fetchEvents(stubbar(sidor)), /formatet kan ha ändrats/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import sodrateatern, { eventsFromPage, eventUrls, showings, stage } from '../scanner/sources/sodrateatern.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SIDA = readFileSync(join(here, 'fixtures', 'sodrateatern-sida.html'), 'utf8');
const ADRESS = 'https://sodrateatern.com/evenemang/musik-show/the-proclaimers/';

const stockholm = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

test('tiden är när det börjar på scen, inte när dörrarna öppnar', () => {
  // ld+json säger 18:00, som är dörrtiden. Sidan säger "På scen 20:00".
  const [rad] = eventsFromPage(SIDA, ADRESS);
  assert.equal(stockholm(rad.starts_at), '2026-09-27 20:00:00');
});

test('resten kommer ur ld+json, rummet ur faktarutan', () => {
  const [rad] = eventsFromPage(SIDA, ADRESS);
  assert.equal(rad.title, 'The Proclaimers');
  assert.equal(rad.category, 'konsert');
  assert.equal(rad.venue_raw, 'Kägelbanan');
  assert.equal(rad.price_min, 595);
  assert.match(rad.ticket_url, /^https:\/\/secure\.tickster\.com\//);
  assert.equal(rad.external_id, 'musik-show/the-proclaimers');
});

test('humor i adressen blir humor, även när ld+json bara säger Event', () => {
  const [rad] = eventsFromPage(SIDA, 'https://sodrateatern.com/evenemang/humor-samtal/nagon/');
  assert.equal(rad.category, 'humor');
});

test('saknas På scen används dörrtiden, saknas blocket används ld+json', () => {
  const utanScen = SIDA.replace(/<div class="item"><span class="desc">På scen<\/span><span class="time">20:00<\/span><\/div>/, '');
  assert.equal(stockholm(showings(utanScen)[0]), '2026-09-27 18:00:00');

  const utanBlock = SIDA.replace(/<div class="showings">[\s\S]*?<\/ul><\/div>/, '');
  const [rad] = eventsFromPage(utanBlock, ADRESS);
  assert.equal(stockholm(rad.starts_at), '2026-09-27 18:00:00');
});

test('flera kvällar på samma sida blir flera rader med egna id', () => {
  const li = /<li>[\s\S]*?<\/li>/.exec(SIDA)[0];
  const två = SIDA.replace(li, li + li.replace('Söndag 27 september 2026', 'Måndag 28 september 2026'));
  const rader = eventsFromPage(två, ADRESS);
  assert.equal(rader.length, 2);
  assert.notEqual(rader[0].external_id, rader[1].external_id);
  assert.ok(rader.every((r) => r.external_id.startsWith('musik-show/the-proclaimers/')));
});

test('bara evenemangsadresser tas ur API-svaret', () => {
  const svar = JSON.stringify([
    { link: 'https://sodrateatern.com/evenemang/musik-show/a/' },
    { link: 'https://sodrateatern.com/evenemang/musik-show/a/' },
    { link: 'https://sodrateatern.com/om-oss/' },
    { link: null },
  ]);
  assert.deepEqual(eventUrls(svar), ['https://sodrateatern.com/evenemang/musik-show/a/']);
  assert.deepEqual(eventUrls('<html>'), []);
});

test('rummet saknas utan faktaruta', () => {
  assert.equal(stage('<p>ingenting</p>'), null);
});

test('hela kedjan utan nät', async () => {
  const sidor = {
    'https://sodrateatern.com/wp-json/wp/v2/events?per_page=100&_fields=link': JSON.stringify([{ link: ADRESS }]),
    [ADRESS]: SIDA,
  };
  const rader = await sodrateatern.fetchEvents({
    log: () => {},
    paus: async () => {},
    robotsOk: async () => true,
    hämta: async (url) => {
      if (url in sidor) return sidor[url];
      throw new Error(`404 ${url}`);
    },
  });
  assert.equal(rader.length, 1);
  assert.equal(rader[0].title, 'The Proclaimers');
});

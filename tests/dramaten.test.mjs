import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import dramaten, {
  categoryFor, eventsFromProduction, nextContent, productionUrls,
} from '../scanner/sources/dramaten.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

const REPERTOAR = fixture('dramaten-repertoar.html');
const UPPSÄTTNING = fixture('dramaten-uppsattning.html');

const stubbar = (sidor) => ({
  paus: async () => {},
  robotsOk: async () => true,
  log: () => {},
  hämta: async (url) => {
    if (url in sidor) return sidor[url];
    throw new Error(`404 ${url}`);
  },
});

test('repertoaren ger uppsättningarnas adresser i en hämtning', () => {
  const urlar = productionUrls(REPERTOAR);

  assert.equal(urlar.length, 5);
  assert.ok(urlar.every((u) => u.startsWith('https://www.dramaten.se/repertoar/')));
  assert.ok(urlar.includes('https://www.dramaten.se/repertoar/misantropen/')
    || urlar.includes('https://www.dramaten.se/repertoar/amnesi/'));
});

test('en uppsättning ger en rad per föreställning', () => {
  // Skillnaden mot Kulturhuset, som publicerar hela speltiden som ett Event.
  const rader = eventsFromProduction(UPPSÄTTNING, {
    sourceUrl: 'https://www.dramaten.se/repertoar/misantropen/',
  });

  assert.equal(rader.length, 3);
  assert.ok(rader.every((r) => r.title === 'Misantropen'));

  // Varje kväll måste ha eget id, annars skriver de över varandra i upserten.
  const idn = new Set(rader.map((r) => r.external_id));
  assert.equal(idn.size, 3, 'föreställningarna delade external_id');

  const tider = new Set(rader.map((r) => r.starts_at));
  assert.equal(tider.size, 3, 'föreställningarna delade starttid');
});

test('zonlösa tider tolkas som Stockholm', () => {
  // Payloaden skriver "2026-09-18T19:00:00" utan zon. Skannern kör i UTC på
  // GitHub Actions, så utan lib/event.mjs parseDateTime hade klockan blivit
  // två timmar fel – och sett rimlig ut i listan.
  const rader = eventsFromProduction(UPPSÄTTNING);
  const första = rader.find((r) => r.starts_at.startsWith('2026-09-18'));

  assert.ok(första, 'hittade inte föreställningen 18 september');
  assert.equal(första.starts_at, '2026-09-18T17:00:00.000Z');
});

test('raden bär scen, biljettlänk och bild', () => {
  const [rad] = eventsFromProduction(UPPSÄTTNING, {
    sourceUrl: 'https://www.dramaten.se/repertoar/misantropen/',
  });

  assert.equal(rad.venue_raw, 'Stora scenen');
  assert.equal(rad.url, 'https://www.dramaten.se/repertoar/misantropen/');
  assert.match(rad.ticket_url, /^https:\/\/biljetter\.dramaten\.se\//);
  assert.match(rad.image_url, /^https:\/\/cms\.dramaten\.se\/media\//);
  assert.equal(rad.organizer, 'Dramaten');
});

test('priset lämnas tomt i stället för gissat', () => {
  // Payloaden bär ingen prisuppgift. Noll hade betytt "fri entré" i listan.
  const [rad] = eventsFromProduction(UPPSÄTTNING);
  assert.equal(rad.price_min, null);
  assert.equal(rad.price_max, null);
});

test('beskrivningen är den korta, inte hela HTML-texten', () => {
  const [rad] = eventsFromProduction(UPPSÄTTNING);

  assert.equal(rad.description, 'En idiotiskt hoppfull komedi fritt efter Molière');
  assert.ok(!rad.description.includes('<'), 'HTML läckte in i beskrivningen');
});

test('scenetiketter blir teater, inte övrigt', () => {
  // Dramatens kategorier är scener och publik, inte genrer. "Övriga scener"
  // matchar inget genremönster – utan eget standardvärde hade allt på huset
  // blivit "övrigt".
  assert.equal(categoryFor([{ name: 'Stora scenen' }]), 'teater');
  assert.equal(categoryFor([{ name: 'Övriga scener' }]), 'teater');
  assert.equal(categoryFor([]), 'teater');
  assert.equal(categoryFor(null), 'teater');
});

test('publik- och formetiketter styr om kategorin', () => {
  assert.equal(categoryFor([{ name: 'Barn & unga' }]), 'barn');
  assert.equal(categoryFor([{ name: 'Samtal & Workshops' }]), 'föreläsning');
  assert.equal(categoryFor([{ name: 'Guidningar' }]), 'övrigt');
  // Publiken vinner över scenen när båda finns, som i lib/event.mjs.
  assert.equal(categoryFor([{ name: 'Barn & unga' }, { name: 'Övriga scener' }]), 'barn');
});

test('en sida utan payload ger inga rader i stället för att kasta', () => {
  assert.deepEqual(eventsFromProduction('<html><body>inget</body></html>'), []);
  assert.equal(nextContent('<html></html>'), null);
  assert.equal(nextContent(null), null);
});

test('trasig JSON i payloaden fäller inte sidan', () => {
  const trasig = '<script id="__NEXT_DATA__" type="application/json">{"props":</script>';
  assert.equal(nextContent(trasig), null);
  assert.deepEqual(eventsFromProduction(trasig), []);
});

test('hela kedjan från repertoar till rader', async () => {
  const sidor = { 'https://www.dramaten.se/repertoar': REPERTOAR };
  for (const url of productionUrls(REPERTOAR)) sidor[url] = UPPSÄTTNING;

  const rader = await dramaten.fetchEvents(stubbar(sidor));

  assert.equal(rader.length, 15); // fem uppsättningar × tre föreställningar
  assert.ok(rader.every((r) => r.category === 'teater'));
});

test('en uppsättning som strular hoppas över, resten hämtas', async () => {
  const urlar = productionUrls(REPERTOAR);
  const sidor = { 'https://www.dramaten.se/repertoar': REPERTOAR };
  sidor[urlar[0]] = UPPSÄTTNING; // bara den första svarar

  const rader = await dramaten.fetchEvents(stubbar(sidor));
  assert.equal(rader.length, 3);
});

test('en tom repertoar kastar i stället för att tiga', async () => {
  // Noll uppsättningar är aldrig sant för Dramaten. Blir payloaden tom har
  // formatet ändrats, och då ska källan gå till error i scan_runs.
  const tom = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"content":{"productions":[]}}}}</script>';
  await assert.rejects(
    () => dramaten.fetchEvents(stubbar({ 'https://www.dramaten.se/repertoar': tom })),
    /payloaden kan ha ändrats/,
  );
});

test('nekande robots.txt stoppar hämtningen', async () => {
  await assert.rejects(
    () => dramaten.fetchEvents({ ...stubbar({}), robotsOk: async () => false }),
    /robots\.txt/,
  );
});

// Museerna, och det de krävde av resten: att det som har börjat men inte
// slutat räknas som aktuellt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { applyFilters, upcomingEvents } from '../lib/upcoming.mjs';
import { groupByDay } from '../public/format.js';
import { toRow as liljevalchsRad } from '../scanner/sources/liljevalchs.mjs';
import { toRow as modernaRad } from '../scanner/sources/modernamuseet.mjs';
import { exhibitionUrls as fotoUrls, rowFromPage as fotoRad } from '../scanner/sources/fotografiska.mjs';
import { exhibitionUrls as nmUrls, parseRange } from '../scanner/sources/nationalmuseum.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const stockholm = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
const NU = new Date('2026-09-27T10:00:00Z');

// --- Pågående ---------------------------------------------------------------

const UTSTÄLLNING = {
  source: 'fotografiska', external_id: 'x', title: 'Lotta Antonsson', category: 'utställning',
  starts_at: '2026-04-24T22:00:00.000Z', ends_at: '2026-11-29T22:59:00.000Z',
  last_seen_at: '2026-09-27T04:00:00Z', status: 'scheduled',
};

test('en utställning som öppnade i april och pågår till november är aktuell', () => {
  assert.equal(upcomingEvents([UTSTÄLLNING], { now: NU }).length, 1);
});

test('men inte om källan slutat lista den', () => {
  // Utan kravet hade en utställning museet plockat bort legat kvar till sitt
  // slutdatum.
  const bortplockad = { ...UTSTÄLLNING, last_seen_at: '2026-09-01T04:00:00Z' };
  assert.equal(upcomingEvents([bortplockad], { now: NU }).length, 0);
});

test('en kväll som passerat är fortfarande inte aktuell', () => {
  const igår = { ...UTSTÄLLNING, starts_at: '2026-09-26T17:00:00Z', ends_at: '2026-09-26T19:00:00Z' };
  assert.equal(upcomingEvents([igår], { now: NU }).length, 0);
});

test('"i helgen" tar med det som pågår i helgen, inte bara det som börjar då', () => {
  const rader = upcomingEvents([UTSTÄLLNING], { now: NU });
  assert.equal(applyFilters(rader, { from: '2026-10-03', to: '2026-10-04' }).length, 1);
  // Men inte det som slutat före perioden.
  assert.equal(applyFilters(rader, { from: '2026-12-05', to: '2026-12-06' }).length, 0);
});

test('det som pågår samlas under "Pågår nu", före dagarna', () => {
  const kväll = { title: 'Konsert', starts_at: '2026-09-28T17:00:00Z' };
  const dagar = groupByDay([UTSTÄLLNING, kväll], NU);
  assert.equal(dagar[0].heading, 'Pågår nu');
  assert.deepEqual(dagar[0].events.map((e) => e.title), ['Lotta Antonsson']);
  assert.equal(dagar[1].events[0].title, 'Konsert');
});

// --- Liljevalchs ------------------------------------------------------------

test('Liljevalchs: ett heldagsspann är en utställning, de engelska hoppas över', () => {
  const post = {
    id: 34441, title: 'Sara-Vide Ericson, DRIFT', url: 'https://liljevalchs.se/kalender/sara-vide-ericson-drift/',
    all_day: true, start_date: '2026-11-13 00:00:00', end_date: '2027-02-28 23:59:59',
    categories: [{ name: 'Konstsamling' }], image: { url: 'https://liljevalchs.se/bild.jpg' },
  };
  const rad = liljevalchsRad(post);
  assert.equal(rad.category, 'utställning');
  assert.equal(stockholm(rad.starts_at), '2026-11-13 00:00:00');
  assert.equal(stockholm(rad.ends_at), '2027-02-28 23:59:00');
  assert.equal(liljevalchsRad({ ...post, url: 'https://liljevalchs.se/en/kalender/sara-vide-ericson-drift/' }), null);
});

test('Liljevalchs: ett samtal med Konstsamling blir inte en utställning', () => {
  const rad = liljevalchsRad({
    id: 1, title: 'Författarsamtal: Lọlá Ákínmádé Åkerström', url: 'https://liljevalchs.se/kalender/samtal/',
    all_day: false, utc_start_date: '2026-10-15 16:00:00', utc_end_date: '2026-10-15 17:30:00',
    categories: [{ name: 'Konstsamling' }],
  });
  assert.equal(rad.category, 'föreläsning');
  assert.equal(stockholm(rad.starts_at), '2026-10-15 18:00:00');
});

// --- Moderna Museet ---------------------------------------------------------

test('Moderna Museet: bara svenska, bara Stockholm, bara det som inte slutat', () => {
  const post = {
    id: 7, lang: 'sv', location: [12], link: 'https://www.modernamuseet.se/sv/stockholm/utstallningar/jan-hafstrom-2026/',
    title: { rendered: 'Jan Håfström' }, acf: { dates: { start_date: '20261017', end_date: '20270314' } },
  };
  const rad = modernaRad(post, NU);
  assert.equal(stockholm(rad.starts_at), '2026-10-17 00:00:00');
  assert.equal(stockholm(rad.ends_at), '2027-03-14 23:59:00');
  assert.equal(modernaRad({ ...post, lang: 'en' }, NU), null);
  assert.equal(modernaRad({ ...post, location: [13] }, NU), null, 'Malmö kom med');
  assert.equal(modernaRad({ ...post, acf: { dates: { start_date: '19980502', end_date: '19980531' } } }, NU), null);
  assert.equal(modernaRad({ ...post, acf: {} }, NU), null, 'en undersida utan datum kom med');
});

// --- Fotografiska -----------------------------------------------------------

test('Fotografiska: datumen läses som dagar, inte som 02:00', () => {
  const html = readFileSync(join(here, 'fixtures', 'fotografiska-utstallning.html'), 'utf8');
  const rad = fotoRad(html, 'https://stockholm.fotografiska.com/sv/exhibitions/lotta-antonsson');
  assert.equal(rad.title, 'Lotta Antonsson');
  assert.equal(rad.category, 'utställning');
  assert.equal(stockholm(rad.starts_at), '2026-04-25 00:00:00');
  assert.equal(stockholm(rad.ends_at), '2026-11-29 23:59:00');
  assert.equal(rad.external_id, 'lotta-antonsson');
});

test('Fotografiska: utställningslänkarna, relativa eller hela', () => {
  const html = '<a href="/sv/exhibitions/martin-parr">x</a><a href="https://stockholm.fotografiska.com/sv/exhibitions/water-and-light">y</a><a href="/sv/utstallningar/past">z</a>';
  assert.deepEqual(fotoUrls(html), [
    'https://stockholm.fotografiska.com/sv/exhibitions/martin-parr',
    'https://stockholm.fotografiska.com/sv/exhibitions/water-and-light',
  ]);
});

// --- Nationalmuseum ---------------------------------------------------------

test('Nationalmuseum: spannet med och utan år före strecket', () => {
  const a = parseRange('24 september 2026–7 februari 2027');
  assert.equal(stockholm(a.starts_at), '2026-09-24 00:00:00');
  assert.equal(stockholm(a.ends_at), '2027-02-07 23:59:00');

  const b = parseRange('18 mars–15 augusti 2027');
  assert.equal(stockholm(b.starts_at), '2027-03-18 00:00:00');

  // Startmånaden efter slutmånaden: utställningen började året innan.
  const c = parseRange('5 november–8 mars 2027');
  assert.equal(stockholm(c.starts_at), '2026-11-05 00:00:00');

  assert.equal(parseRange('Permanent samling'), null);
});

test('Nationalmuseum: inte utställningar på andra museer, inte arkivet', () => {
  const html = [
    'href="https://www.nationalmuseum.se/utställningar/till-havet"',
    'href="https://www.nationalmuseum.se/utställningar/kommande-utställningar"',
    'href="https://www.nationalmuseum.se/utställningar/kommande-utställningar/akseli-gallen-kallela"',
    'href="https://www.nationalmuseum.se/utställningar/på-annan-plats/livet-designat"',
    'href="https://www.nationalmuseum.se/utställningar/tidigare-utställningar/utställningar-2025"',
  ].join(' ');
  assert.deepEqual(nmUrls(html), [
    'https://www.nationalmuseum.se/utställningar/till-havet',
    'https://www.nationalmuseum.se/utställningar/kommande-utställningar/akseli-gallen-kallela',
  ]);
});

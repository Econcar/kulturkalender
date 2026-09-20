import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { productionKey, upcomingEvents, upcomingProductions } from '../lib/upcoming.mjs';
import { runLabel } from '../public/format.js';

const rot = join(dirname(fileURLToPath(import.meta.url)), '..');
const läs = (fil) => readFileSync(join(rot, fil), 'utf8');

const NU = new Date('2026-09-20T12:00:00.000Z');
const om = (timmar) => new Date(NU.getTime() + timmar * 3600_000).toISOString();

const VENUES = [
  { slug: 'dramaten', name: 'Dramaten' },
  { slug: 'konserthuset', name: 'Konserthuset Stockholm' },
];

const rad = (över = {}) => ({
  source: 'dramaten',
  external_id: 'p1',
  url: 'https://www.dramaten.se/repertoar/amnesi/',
  title: 'Amnesi',
  category: 'teater',
  starts_at: om(24),
  status: 'scheduled',
  ...över,
});

const vy = (rader) => upcomingEvents(rader, { venues: VENUES, now: NU });

test('sextio kvällar av samma pjäs blir en uppsättning', () => {
  const kvällar = Array.from({ length: 60 }, (_, i) => rad({
    external_id: `p${i}`,
    starts_at: om(24 + i * 24),
  }));

  const ut = upcomingProductions(vy(kvällar));

  assert.equal(ut.length, 1);
  assert.equal(ut[0].performances, 60);
  assert.equal(ut[0].title, 'Amnesi');
  assert.equal(ut[0].first_at, om(24));
  assert.equal(ut[0].last_at, om(24 + 59 * 24));
});

test('Dramaten grupperas på adressen, inte på titeln', () => {
  // Uppmätt på skarp data: Dramaten har 46 titlar på 29 uppsättningar,
  // eftersom syntolkade och skolföreställningar får egna namn. Grupperar man
  // på titel spricker Amnesi i tre.
  const ut = upcomingProductions(vy([
    rad({ external_id: 'a', title: 'Amnesi' }),
    rad({ external_id: 'b', title: 'Amnesi (syntolkad)' }),
    rad({ external_id: 'c', title: 'Amnesi Skolföreställning' }),
  ]));

  assert.equal(ut.length, 1, 'titelvarianterna blev egna uppsättningar');
  assert.equal(ut[0].performances, 3);
});

test('kortaste titeln är uppsättningens namn', () => {
  // Husen hänger på kvalificerare efter grundtiteln, så alfabetisk ordning ger
  // fel svar: min() hade valt "Amnesi (syntolkad)" före "Amnesi".
  const ut = upcomingProductions(vy([
    rad({ external_id: 'a', title: 'Amnesi Skolföreställning' }),
    rad({ external_id: 'b', title: 'Amnesi' }),
  ]));

  assert.equal(ut[0].title, 'Amnesi');
});

test('Konserthuset grupperas på slugen, för deras adresser är unika per kväll', () => {
  // .../schumanns-tredje-symfoni/20260916-1800/ - adressen bär datumet, så
  // url-nyckeln ger 297 uppsättningar på 297 rader. Slugen ger 171.
  const ut = upcomingProductions(vy([
    {
      source: 'konserthuset',
      external_id: 'schumanns-tredje-symfoni/20260916-1800',
      url: 'https://www.konserthuset.se/kalender/konsert/2026/schumanns-tredje-symfoni/20260916-1800/',
      title: 'Schumanns tredje symfoni',
      category: 'konsert',
      starts_at: om(24),
      status: 'scheduled',
    },
    {
      source: 'konserthuset',
      external_id: 'schumanns-tredje-symfoni/20260917-1800',
      url: 'https://www.konserthuset.se/kalender/konsert/2026/schumanns-tredje-symfoni/20260917-1800/',
      title: 'Schumanns tredje symfoni',
      category: 'konsert',
      starts_at: om(48),
      status: 'scheduled',
    },
  ]));

  assert.equal(ut.length, 1);
  assert.equal(ut[0].performances, 2);
});

test('två hus med samma slug slås aldrig ihop', () => {
  // "guidad-visning" finns hos flera hus. Källan ingår därför alltid i nyckeln.
  const a = productionKey({ source: 'konserthuset', external_id: 'guidad-visning/20260101-1200' });
  const b = productionKey({ source: 'operan', external_id: 'guidad-visning/20260101-1200', url: '/guidad-visning' });

  assert.notEqual(a, b);
});

test('en rad utan adress faller tillbaka på titeln', () => {
  const nyckel = productionKey({ source: 'kulturhuset', title: 'Tartuffe', url: null });
  assert.equal(nyckel, 'kulturhuset|Tartuffe');
  assert.equal(productionKey({ source: 'x' }), null);
  assert.equal(productionKey(null), null);
});

test('priset spänner över hela uppsättningen', () => {
  const ut = upcomingProductions(vy([
    rad({ external_id: 'a', price_min: 290, price_max: 575 }),
    rad({ external_id: 'b', price_min: 150, price_max: 420 }),
    rad({ external_id: 'c', price_min: null, price_max: null }),
  ]));

  assert.equal(ut[0].price_min, 150);
  assert.equal(ut[0].price_max, 575);
});

test('bild och text tas från en rad som har dem', () => {
  // Enskilda kvällar saknar ofta bild. Att visa uppsättningen utan bild bara
  // för att den tidigaste kvällen saknade den vore en sämre lista.
  const ut = upcomingProductions(vy([
    rad({ external_id: 'a', image_url: null, description: 'Kort.' }),
    rad({ external_id: 'b', image_url: 'https://exempel.se/bild.jpg', description: 'En betydligt längre beskrivning av pjäsen.' }),
  ]));

  assert.equal(ut[0].image_url, 'https://exempel.se/bild.jpg');
  assert.match(ut[0].description, /betydligt längre/);
});

test('rum räknas, inte namnges', () => {
  const ut = upcomingProductions(vy([
    rad({ external_id: 'a', venue_raw: 'Stora scenen' }),
    rad({ external_id: 'b', venue_raw: 'Lilla scenen' }),
    rad({ external_id: 'c', venue_raw: 'Stora scenen' }),
  ]));

  assert.equal(ut[0].stages, 2);
});

test('repertoaren kommer i premiärordning', () => {
  const ut = upcomingProductions(vy([
    rad({ external_id: 'sen', url: 'https://x.se/b/', title: 'Senare', starts_at: om(240) }),
    rad({ external_id: 'tidig', url: 'https://x.se/a/', title: 'Tidigare', starts_at: om(24) }),
  ]));

  assert.deepEqual(ut.map((p) => p.title), ['Tidigare', 'Senare']);
});

test('vyns fält är desamma i SQL som i JS', () => {
  // Samma spärr som för upcoming_events och venue_summary, av samma skäl:
  // glider de isär visar det lokala läget något annat än drift.
  const sql = läs('db/schema.sql');
  const start = sql.indexOf('create view public.upcoming_productions');
  const slut = sql.indexOf('from nycklade', start);
  assert.ok(start !== -1 && slut !== -1, 'upcoming_productions hittades inte');

  // Sista select-raden före CTE-slutet: den första select:en ligger inne i
  // CTE:n och hade gett kolumnen "case" ur uttrycket som bygger nyckeln.
  const block = sql.slice(start, slut).split(String.fromCharCode(10));
  const select = block.slice(block.lastIndexOf('select') + 1).join(String.fromCharCode(10));
  const kolumner = new Set();
  for (const rad of select.split('\n').map((r) => r.trim())) {
    if (!rad || rad.startsWith('--') || rad === 'select') continue;
    const alias = / as ([a-z_]+),?$/.exec(rad);
    if (alias) kolumner.add(alias[1]);
    else {
      const bart = rad.replace(/,$/, '');
      if (/^[a-z_]+$/.test(bart)) kolumner.add(bart);
    }
  }

  assert.ok(kolumner.size > 10, `hittade bara ${kolumner.size} kolumner – utsökningen är trasig`);

  const [iJs] = upcomingProductions(vy([rad()]));
  for (const kolumn of kolumner) {
    assert.ok(kolumn in iJs, `SQL-vyn har ${kolumn} men upcomingProductions saknar den`);
  }
  for (const fält of Object.keys(iJs)) {
    assert.ok(kolumner.has(fält), `upcomingProductions har ${fält} men SQL-vyn saknar den`);
  }
});

// --- Speltiden som text ----------------------------------------------------

test('speltiden skrivs som ett spann med antal', () => {
  assert.equal(
    runLabel('2026-09-25T17:00:00Z', '2026-12-05T18:00:00Z', 31, NU),
    '25 september – 5 december, 31 föreställningar',
  );
});

test('året skrivs ut bara när det skiljer sig från årets', () => {
  // "23 mars" i september 2026 läses som i våras. "23 mars 2027" gör det inte.
  assert.equal(
    runLabel('2026-11-25T18:00:00Z', '2027-03-23T18:00:00Z', 60, NU),
    '25 november – 23 mars 2027, 60 föreställningar',
  );
});

test('en ensam föreställning får inget antal efter sig', () => {
  // "1 föreställning" tillför ingenting - datumet säger redan allt.
  assert.equal(runLabel('2026-10-16T17:00:00Z', null, 1, NU), '16 oktober');
  assert.equal(runLabel('2026-10-16T17:00:00Z', '2026-10-16T17:00:00Z', 1, NU), '16 oktober');
});

test('flera föreställningar samma dag skrivs som en dag', () => {
  assert.equal(runLabel('2026-10-16T08:00:00Z', '2026-10-16T18:00:00Z', 3, NU), '16 oktober, 3 föreställningar');
});

test('skräp ger tom sträng, inte Invalid Date', () => {
  assert.equal(runLabel('inte ett datum', null, 1, NU), '');
  assert.equal(runLabel(null, null, 1, NU), '');
});

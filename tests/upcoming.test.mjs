import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { applyFilters, toViewRow, upcomingEvents } from '../lib/upcoming.mjs';

const rot = join(dirname(fileURLToPath(import.meta.url)), '..');
const läs = (fil) => readFileSync(join(rot, fil), 'utf8');

const NU = new Date('2026-09-13T12:00:00.000Z');
const om = (timmar) => new Date(NU.getTime() + timmar * 3600_000).toISOString();

const rad = (över = {}) => ({
  source: 'kulturhuset',
  external_id: 'konserter/x',
  title: 'En konsert',
  category: 'konsert',
  venue_raw: 'Studion',
  address: 'Sergels torg, Stockholm',
  starts_at: om(24),
  status: 'scheduled',
  ...över,
});

test('vyns fält är desamma som i SQL-vyn', () => {
  // Den här spärren är hela skälet till att lib/upcoming.mjs får finnas. Går
  // fälten isär visar det lokala läget något annat än drift, och då är det
  // värre än inget lokalt läge alls.
  const sql = läs('db/schema.sql');
  const vy = /create view public\.upcoming_events[\s\S]*?from public\.events e/.exec(sql);
  assert.ok(vy, 'upcoming_events hittades inte i db/schema.sql');

  // Select-listan rad för rad: aliaset om det finns ("… as venue"), annars
  // namnet efter punkten ("e.title" → "title"). Kommentarrader hoppas över.
  const rader = vy[0].split('\n').map((rad) => rad.trim());
  const start = rader.indexOf('select');
  assert.ok(start !== -1, 'select-raden hittades inte i vyn');

  const kolumner = new Set(
    rader
      .slice(start + 1)
      .map((rad) => rad.replace(/,$/, ''))
      .filter((rad) => rad && !rad.startsWith('--') && !rad.startsWith('from'))
      .map((rad) => {
        const alias = /\s+as\s+(\w+)$/i.exec(rad);
        if (alias) return alias[1];
        const sista = rad.split('.').pop();
        return /^\w+$/.test(sista) ? sista : null;
      })
      .filter(Boolean),
  );

  assert.ok(kolumner.size > 10, `hittade bara ${kolumner.size} kolumner – utsökningen är trasig`);

  const iJs = new Set(Object.keys(toViewRow(rad(), null, NU)));

  for (const kolumn of kolumner) {
    assert.ok(iJs.has(kolumn), `SQL-vyn har ${kolumn} men lib/upcoming.mjs saknar den`);
  }
  for (const fält of iJs) {
    assert.ok(kolumner.has(fält), `lib/upcoming.mjs har ${fält} men SQL-vyn saknar den`);
  }
});

test('inställda evenemang visas inte', () => {
  const ut = upcomingEvents([rad(), rad({ external_id: 'y', status: 'cancelled' })], { now: NU });
  assert.equal(ut.length, 1);
});

test('uppskjutna visas däremot, med sin flagga kvar', () => {
  const ut = upcomingEvents([rad({ status: 'postponed' })], { now: NU });
  assert.equal(ut.length, 1);
  assert.equal(ut[0].status, 'postponed');
});

test('passerade faller bort, men pågående är kvar i tre timmar', () => {
  const rader = [
    rad({ external_id: 'igar', starts_at: om(-48) }),
    rad({ external_id: 'nyss', starts_at: om(-1) }),
    rad({ external_id: 'strax', starts_at: om(1) }),
  ];
  const ut = upcomingEvents(rader, { now: NU });

  assert.deepEqual(ut.map((r) => r.id.split('|')[1]), ['nyss', 'strax']);
});

test('scenen slås upp när den är kopplad, annars används källans text', () => {
  const venues = [{ id: 'v1', name: 'Kulturhuset Stadsteatern', slug: 'kulturhuset', address: 'Sergels torg 3' }];

  const kopplad = upcomingEvents([rad({ venue_id: 'v1' })], { venues, now: NU })[0];
  assert.equal(kopplad.venue, 'Kulturhuset Stadsteatern');
  assert.equal(kopplad.venue_slug, 'kulturhuset');
  assert.equal(kopplad.address, 'Sergels torg 3');

  const okopplad = upcomingEvents([rad()], { venues, now: NU })[0];
  assert.equal(okopplad.venue, 'Studion');
  assert.equal(okopplad.venue_slug, null);
  assert.equal(okopplad.address, 'Sergels torg, Stockholm');
});

test('listan kommer i tidsordning', () => {
  const rader = [
    rad({ external_id: 'sen', starts_at: om(72) }),
    rad({ external_id: 'tidig', starts_at: om(5) }),
    rad({ external_id: 'mellan', starts_at: om(30) }),
  ];
  const ut = upcomingEvents(rader, { now: NU });
  assert.deepEqual(ut.map((r) => r.id.split('|')[1]), ['tidig', 'mellan', 'sen']);
});

test('kategorifiltret plockar rätt rader', () => {
  const rader = upcomingEvents([rad(), rad({ external_id: 'y', category: 'teater' })], { now: NU });

  assert.equal(applyFilters(rader, { category: 'teater' }).length, 1);
  assert.equal(applyFilters(rader, { category: 'cirkus' }).length, 0);
  assert.equal(applyFilters(rader, {}).length, 2);
});

test('sökningen träffar titel, beskrivning och scen', () => {
  const rader = upcomingEvents([
    rad({ external_id: 'a', title: 'Trollflöjten' }),
    rad({ external_id: 'b', description: 'En kväll med Mozart' }),
    rad({ external_id: 'c', venue_raw: 'Konserthuset' }),
    rad({ external_id: 'd', title: 'Något annat' }),
  ], { now: NU });

  assert.equal(applyFilters(rader, { q: 'trollflöjten' }).length, 1);
  assert.equal(applyFilters(rader, { q: 'mozart' }).length, 1);
  assert.equal(applyFilters(rader, { q: 'konserthuset' }).length, 1);
  // Ett tecken söker inte – samma gräns som functions/api/events.js.
  assert.equal(applyFilters(rader, { q: 't' }).length, 4);
});

test('limit och offset bläddrar', () => {
  const rader = upcomingEvents(
    Array.from({ length: 10 }, (_, i) => rad({ external_id: `e${i}`, starts_at: om(i + 1) })),
    { now: NU },
  );

  assert.equal(applyFilters(rader, { limit: 3 }).length, 3);
  assert.equal(applyFilters(rader, { limit: 3, offset: 9 }).length, 1);
  assert.equal(applyFilters(rader, { limit: 3, offset: 0 })[0].id, 'kulturhuset|e0');
  assert.equal(applyFilters(rader, { limit: 3, offset: 3 })[0].id, 'kulturhuset|e3');
});

test('days_until räknas från nu', () => {
  const ut = upcomingEvents([rad({ starts_at: om(49) })], { now: NU });
  assert.equal(ut[0].days_until, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { applyFilters, toViewRow, upcomingEvents, venueSummary } from '../lib/upcoming.mjs';

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

test('huset slås upp på källan, och rummet står kvar för sig', () => {
  // De två sakerna som båda heter "scen": huset man går till och rummet man
  // sitter i. Blandas de ihop står det "Stora scenen" i listan utan att det
  // framgår att det är Dramatens.
  const venues = [{ slug: 'kulturhuset', name: 'Kulturhuset Stadsteatern', address: 'Sergels torg 3' }];

  const [r] = upcomingEvents([rad()], { venues, now: NU });
  assert.equal(r.venue, 'Kulturhuset Stadsteatern');
  assert.equal(r.venue_slug, 'kulturhuset');
  assert.equal(r.stage, 'Studion');
  assert.equal(r.address, 'Sergels torg 3');
});

test('en källa utan registrerat hus faller tillbaka, den försvinner inte', () => {
  const [r] = upcomingEvents([rad({ source: 'okänd', organizer: 'Någon Scen' })], {
    venues: [], now: NU,
  });

  assert.equal(r.venue, 'Någon Scen');
  assert.equal(r.venue_slug, null);
  assert.equal(r.stage, 'Studion');
});

test('utan både hus och arrangör används källans id, aldrig tomt', () => {
  const [r] = upcomingEvents([rad({ source: 'nyscen', organizer: undefined })], {
    venues: [], now: NU,
  });
  assert.equal(r.venue, 'nyscen');
});

test('husen sammanställs med antal, och noll skrivs ut', () => {
  const venues = [
    { slug: 'kulturhuset', name: 'Kulturhuset Stadsteatern' },
    { slug: 'dramaten', name: 'Dramaten' },
  ];
  const rader = upcomingEvents([
    rad({ external_id: 'a' }),
    rad({ external_id: 'b', starts_at: om(48) }),
  ], { venues, now: NU });

  const sammanställning = venueSummary(rader, { venues });

  assert.equal(sammanställning.length, 2);
  const kh = sammanställning.find((v) => v.slug === 'kulturhuset');
  assert.equal(kh.upcoming_count, 2);
  assert.equal(kh.next_at, rader[0].starts_at);

  // Dramaten har inga rader men ska ändå stå i listan. Ett hus som tappas helt
  // ser ut som att vi inte bevakar det.
  const dr = sammanställning.find((v) => v.slug === 'dramaten');
  assert.equal(dr.upcoming_count, 0);
  assert.equal(dr.next_at, null);
});

test('husen bär med sig när de senast hämtades', () => {
  // Raden högst upp på sidan hämtar sin tid härifrån. Faller fältet bort står
  // det bara ett datum där, och sidan slutar säga hur gamla uppgifterna är –
  // ett bortfall som inte syns som ett fel.
  const venues = [
    { slug: 'kulturhuset', name: 'Kulturhuset Stadsteatern' },
    { slug: 'dramaten', name: 'Dramaten' },
  ];
  const rader = upcomingEvents([
    rad({ external_id: 'a', last_seen_at: '2026-09-13T02:10:00.000Z' }),
    rad({ external_id: 'b', last_seen_at: '2026-09-14T02:10:00.000Z' }),
  ], { venues, now: NU });

  const sammanställning = venueSummary(rader, { venues });

  // Den senaste av husets rader, precis som max(e.last_seen_at) i vyn.
  assert.equal(sammanställning.find((v) => v.slug === 'kulturhuset').last_scan_at,
    '2026-09-14T02:10:00.000Z');
  // Ett hus utan rader vet vi ingenting om. Null, inte dagens datum.
  assert.equal(sammanställning.find((v) => v.slug === 'dramaten').last_scan_at, null);
});

test('last_scan_at finns i SQL-vyn och inte bara i JS', () => {
  // Samma sorts spärr som fältkontrollen för upcoming_events ovan. Fältet
  // driver raden högst upp på sidan; finns det bara i det lokala läget står
  // det inget om färskhet i drift, och tomrummet ser ut som ett designval.
  const sql = läs('db/schema.sql');
  assert.ok(sql.includes('as last_scan_at'), 'venue_summary i db/schema.sql saknar last_scan_at');

  const [hus] = venueSummary([], { venues: [{ slug: 'x', name: 'X' }] });
  assert.ok('last_scan_at' in hus, 'venueSummary saknar last_scan_at');
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

test('sökningen träffar titel, beskrivning, hus och rum', () => {
  const rader = upcomingEvents([
    rad({ external_id: 'a', title: 'Trollflöjten' }),
    rad({ external_id: 'b', description: 'En kväll med Mozart' }),
    rad({ external_id: 'c', venue_raw: 'Lejonkulan' }),
    rad({ external_id: 'd', title: 'Något annat' }),
  ], { now: NU });

  assert.equal(applyFilters(rader, { q: 'trollflöjten' }).length, 1);
  assert.equal(applyFilters(rader, { q: 'mozart' }).length, 1);
  // Rummet ska gå att söka på, inte bara huset: den som söker "Lejonkulan"
  // letar efter samma sorts sak som den som söker "Dramaten".
  assert.equal(applyFilters(rader, { q: 'lejonkulan' }).length, 1);
  assert.equal(applyFilters(rader, { q: 'kulturhuset' }).length, 4);
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

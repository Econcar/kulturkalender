import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { extractAllJsonLd, findByType, hasType } from '../lib/ldjson.mjs';

// Samma modul, tredje domänen. Testerna pekar om från Recipe till Event, men
// koden i lib/ldjson.mjs är oförändrad sedan leasingprojektet läste Product ur
// den – bara filhuvudet är omskrivet. Att den överlevt två pivoter utan en
// kodändring är beviset på att den är generisk på riktigt och inte till namnet.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

test('evenemanget hittas inuti ett @graph', () => {
  const event = findByType(fixture('evenemang-graph.html'), 'TheaterEvent');

  assert.equal(event.name, 'Parzival');
  assert.equal(event.startDate, '2026-11-04T19:00:00+01:00');
  assert.equal(event.location.name, 'Stora scenen');
  assert.equal(event.offers.length, 2);
});

test('evenemanget hittas i en array, även när @type är flera värden', () => {
  const event = findByType(fixture('evenemang-array.html'), 'MusicEvent');

  assert.equal(event.name, 'Nattjazz');
  assert.deepEqual(event['@type'], ['NewsArticle', 'MusicEvent']);
});

test('ett trasigt block fäller inte de andra', () => {
  // Fixturen har ett block med ett efterföljande kommatecken – ogiltig JSON.
  const nodes = extractAllJsonLd(fixture('evenemang-array.html'));
  assert.ok(nodes.length >= 3, 'de giltiga blocken ska finnas kvar');
  assert.ok(nodes.every((n) => n.name !== 'Trasig'), 'det trasiga ska inte komma med');
});

test('alla typer på sidan går att lista', () => {
  const nodes = extractAllJsonLd(fixture('evenemang-graph.html'));
  assert.deepEqual(nodes.map((n) => n['@type']), ['WebSite', 'BreadcrumbList', 'TheaterEvent']);
});

test('hasType är okänsligt för skiftläge och klarar array-typer', () => {
  assert.equal(hasType({ '@type': 'Event' }, 'event'), true);
  assert.equal(hasType({ '@type': ['NewsArticle', 'MusicEvent'] }, 'MusicEvent'), true);
  assert.equal(hasType({ '@type': 'Product' }, 'Event'), false);
  assert.equal(hasType({}, 'Event'), false);
  assert.equal(hasType(null, 'Event'), false);
});

test('en undertyp är inte samma sak som Event för hasType', () => {
  // hasType jämför exakt och känner inte schema.org-arvet. Det är därför
  // lib/event.mjs letar igenom hela EVENT_TYPES i stället för att fråga en
  // gång efter "Event" – en MusicEvent hade annars aldrig hittats.
  assert.equal(hasType({ '@type': 'MusicEvent' }, 'Event'), false);
});

test('en sida utan ld+json ger tom lista, inte fel', () => {
  assert.deepEqual(extractAllJsonLd('<html><body>Inget här</body></html>'), []);
  assert.equal(findByType('<html></html>', 'Event'), null);
  assert.deepEqual(extractAllJsonLd(null), []);
});

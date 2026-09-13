import test from 'node:test';
import assert from 'node:assert/strict';

import {
  completeness, dedupeBatch, eventKey, groupDuplicates, normalizeTitle, sourceKey,
} from '../scanner/lib/dedupe.mjs';

const rad = (över = {}) => ({
  source: 'kulturhuset',
  external_id: 'fatoumata-diawara',
  title: 'Fatoumata Diawara',
  venue_raw: 'Studion, plan 1',
  starts_at: '2026-10-17T18:00:00.000Z',
  ...över,
});

test('nyckeln inom en källa är källans egna id', () => {
  assert.equal(sourceKey(rad()), 'kulturhuset|fatoumata-diawara');
});

test('samma evenemang hos två källor får samma evenemangsnyckel', () => {
  const scenen = rad();
  const biljettsajten = rad({ source: 'ticketmaster', external_id: '99812' });

  assert.notEqual(sourceKey(scenen), sourceKey(biljettsajten));
  assert.equal(eventKey(scenen), eventKey(biljettsajten));
});

test('sekunder skiljer inte två rader åt', () => {
  // Källor avrundar olika. "19:00:00" och "19:00:30" är samma konsert.
  const a = rad({ starts_at: '2026-10-17T18:00:00.000Z' });
  const b = rad({ starts_at: '2026-10-17T18:00:30.000Z' });
  assert.equal(eventKey(a), eventKey(b));
});

test('titeln jämförs utan den svans scener hänger på', () => {
  assert.equal(normalizeTitle('Misantropen – Stora scenen'), 'misantropen');
  assert.equal(normalizeTitle('Misantropen'), 'misantropen');
  assert.equal(normalizeTitle('  MISANTROPEN  '), 'misantropen');
  assert.equal(normalizeTitle(null), '');
});

test('svenska tecken överlever normaliseringen', () => {
  // \p{L} och inte a-z: "Trollflöjten" får inte bli "trollfl jten", för då
  // matchar den aldrig sig själv från en annan källa.
  assert.equal(normalizeTitle('Trollflöjten'), 'trollflöjten');
  assert.equal(normalizeTitle('Änglar & Demoner'), 'änglar demoner');
});

test('dubbletter inom en källa slås ihop, mest kompletta vinner', () => {
  const mager = rad();
  const fyllig = rad({ description: 'En beskrivning', image_url: 'https://x/a.jpg', price_min: 550 });

  const ut = dedupeBatch([mager, fyllig]);

  assert.equal(ut.length, 1);
  assert.equal(ut[0].description, 'En beskrivning');
});

test('ordningen avgör inte vilken rad som vinner', () => {
  const mager = rad();
  const fyllig = rad({ description: 'En beskrivning', price_min: 550 });

  assert.equal(dedupeBatch([fyllig, mager])[0].description, 'En beskrivning');
  assert.equal(dedupeBatch([mager, fyllig])[0].description, 'En beskrivning');
});

test('rader utan external_id kastas', () => {
  // Utan stabilt id går raden inte att upserta – den hade blivit en ny rad
  // vid varje körning och fyllt listan med samma konsert om och om igen.
  assert.deepEqual(dedupeBatch([rad({ external_id: undefined })]), []);
  assert.deepEqual(dedupeBatch([null, undefined]), []);
  assert.deepEqual(dedupeBatch(null), []);
});

test('samma evenemang över källor grupperas', () => {
  const grupper = groupDuplicates([
    rad(),
    rad({ source: 'ticketmaster', external_id: '99812' }),
    rad({ external_id: 'annat', title: 'Något annat' }),
  ]);

  assert.equal(grupper.size, 2);
  assert.equal([...grupper.values()].find((g) => g.length === 2).length, 2);
});

test('completeness räknar ifyllda fält, inte tomma strängar', () => {
  assert.ok(completeness(rad({ description: 'text' })) > completeness(rad()));
  assert.equal(completeness(rad({ description: '' })), completeness(rad()));
  assert.equal(completeness(null), 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { dateRange } from '../public/format.js';
import { buildQuery } from '../public/api.js';

// Veckan 14–20 september 2026: måndag till söndag.
const MÅNDAG = new Date('2026-09-14T09:00:00Z');
const TISDAG = new Date('2026-09-15T09:00:00Z');
const FREDAG = new Date('2026-09-18T09:00:00Z');
const LÖRDAG = new Date('2026-09-19T09:00:00Z');
const SÖNDAG = new Date('2026-09-20T09:00:00Z');

test('utan period filtreras ingenting', () => {
  // Tomma fält och inte dagens datum: "när som helst" ska visa hela listan,
  // inte i dag.
  assert.deepEqual(dateRange('', TISDAG), { from: '', to: '' });
  assert.deepEqual(dateRange(null, TISDAG), { from: '', to: '' });
});

test('okänd period filtreras inte heller', () => {
  // En adress med ?nar=nagot-annat ska visa allt, inte ett tomt spann som
  // ser ut som att det inte finns några evenemang.
  assert.deepEqual(dateRange('förra-veckan', TISDAG), { from: '', to: '' });
});

test('i dag och i morgon är ett dygn var', () => {
  assert.deepEqual(dateRange('idag', TISDAG), { from: '2026-09-15', to: '2026-09-15' });
  assert.deepEqual(dateRange('imorgon', TISDAG), { from: '2026-09-16', to: '2026-09-16' });
});

test('i morgon över ett månadsskifte', () => {
  // Datumräkning som inte går via Date tappar den här.
  assert.deepEqual(
    dateRange('imorgon', new Date('2026-09-30T09:00:00Z')),
    { from: '2026-10-01', to: '2026-10-01' },
  );
});

test('i helgen är kommande lördag och söndag', () => {
  for (const [namn, nu] of [['måndag', MÅNDAG], ['tisdag', TISDAG], ['fredag', FREDAG]]) {
    assert.deepEqual(
      dateRange('helg', nu),
      { from: '2026-09-19', to: '2026-09-20' },
      `${namn} pekade fel helg`,
    );
  }
});

test('är det redan helg menas den man är i, inte nästa', () => {
  // På en lördag är "i helgen" i dag och i morgon. Att skicka den som frågar
  // på lördag till nästa lördag är att svara på något annat än det hen frågade.
  assert.deepEqual(dateRange('helg', LÖRDAG), { from: '2026-09-19', to: '2026-09-20' });
  // På söndagen är helgen slut i kväll.
  assert.deepEqual(dateRange('helg', SÖNDAG), { from: '2026-09-20', to: '2026-09-20' });
});

test('den här veckan slutar på söndag, inte om sju dagar', () => {
  assert.deepEqual(dateRange('vecka', MÅNDAG), { from: '2026-09-14', to: '2026-09-20' });
  assert.deepEqual(dateRange('vecka', TISDAG), { from: '2026-09-15', to: '2026-09-20' });
  assert.deepEqual(dateRange('vecka', FREDAG), { from: '2026-09-18', to: '2026-09-20' });
  // På söndagen är veckan en dag lång, inte noll och inte åtta.
  assert.deepEqual(dateRange('vecka', SÖNDAG), { from: '2026-09-20', to: '2026-09-20' });
});

test('dygnet räknas i Stockholm, inte i UTC', () => {
  // 22:30 UTC är redan nästa dag i Stockholm. Den som öppnar sidan sent på
  // kvällen ska se morgondagen som morgondag, inte som i dag.
  assert.deepEqual(
    dateRange('idag', new Date('2026-09-15T22:30:00Z')),
    { from: '2026-09-16', to: '2026-09-16' },
  );
});

test('spannet går vidare till frågesträngen', () => {
  const q = new URLSearchParams(buildQuery({ from: '2026-09-19', to: '2026-09-20' }));

  assert.equal(q.get('from'), '2026-09-19');
  assert.equal(q.get('to'), '2026-09-20');
});

test('tomt spann skickas inte med alls', () => {
  // Ett tomt from i frågan vore inte samma sak som inget from: API:et skulle
  // se parametern och sidan skulle be om något den inte menar.
  const q = new URLSearchParams(buildQuery({ ...dateRange('', TISDAG) }));

  assert.equal(q.get('from'), null);
  assert.equal(q.get('to'), null);
  assert.equal(buildQuery({ ...dateRange('', TISDAG) }), 'limit=60');
});

test('datumen kombineras med de andra filtren', () => {
  const q = new URLSearchParams(buildQuery({
    category: 'konsert', venue: 'konserthuset', ...dateRange('helg', TISDAG),
  }));

  assert.equal(q.get('category'), 'konsert');
  assert.equal(q.get('venue'), 'konserthuset');
  assert.equal(q.get('from'), '2026-09-19');
  assert.equal(q.get('to'), '2026-09-20');
});

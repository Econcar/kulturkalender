// Pre-push-spärren för versionshöjningen. Se scripts/versionskoll.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { versionsfel } from '../scripts/versionskoll.mjs';

test('ändrad sida utan höjd version stoppas, med filen i felet', () => {
  const fel = versionsfel(['public/app.js', 'lib/http.mjs'], false);
  assert.match(fel, /public\/app\.js/);
  assert.match(fel, /Höj den/);
});

test('ändrad sida med höjd version går igenom', () => {
  assert.equal(versionsfel(['public/app.js', 'public/version.js', 'public/sw.js'], true), null);
});

test('ändringar utanför public/ kräver ingen höjning', () => {
  assert.equal(versionsfel(['lib/http.mjs', 'db/schema.sql', 'tests/x.test.mjs'], false), null);
  assert.equal(versionsfel([], false), null);
});

test('version.js och sw.js själva kräver ingen höjning utöver sig själva', () => {
  assert.equal(versionsfel(['public/sw.js'], false), null);
});

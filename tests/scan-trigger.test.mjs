import test from 'node:test';
import assert from 'node:assert/strict';

import { COOLDOWN_MINUTER, mayTrigger, secretsEqual } from '../lib/scan-trigger.mjs';

const NU = new Date('2026-09-20T18:00:00Z');
const minuterSen = (n) => new Date(NU.getTime() - n * 60_000).toISOString();

test('utan tidigare körning får svepet starta', () => {
  assert.deepEqual(mayTrigger({ lastRun: null, now: NU }), { ok: true });
});

test('en körning som pågår dubbleras inte', () => {
  // Två samtidiga svep hämtar samma sidor två gånger och skriver över
  // varandras rader.
  for (const status of ['queued', 'in_progress']) {
    const beslut = mayTrigger({ lastRun: { status, createdAt: minuterSen(1) }, now: NU });
    assert.equal(beslut.ok, false, `${status} släpptes igenom`);
    assert.equal(beslut.reason, 'pågår');
  }
});

test('för snart efter förra svepet nekas, med väntetid', () => {
  const beslut = mayTrigger({
    lastRun: { status: 'completed', conclusion: 'success', createdAt: minuterSen(3) },
    now: NU,
  });

  assert.equal(beslut.ok, false);
  assert.equal(beslut.reason, 'för snart');
  // Sju minuter kvar av tio.
  assert.equal(beslut.waitSeconds, 7 * 60);
});

test('efter spärren får det startas igen', () => {
  const beslut = mayTrigger({
    lastRun: { status: 'completed', conclusion: 'success', createdAt: minuterSen(COOLDOWN_MINUTER + 1) },
    now: NU,
  });

  assert.equal(beslut.ok, true);
});

test('spärren gäller även efter en misslyckad körning', () => {
  // Frestelsen är att släppa igenom ett nytt försök direkt när det gick fel.
  // Men ett svep som misslyckades hämtade sidorna ändå - scenerna märker
  // ingen skillnad på våra avsikter.
  const beslut = mayTrigger({
    lastRun: { status: 'completed', conclusion: 'failure', createdAt: minuterSen(2) },
    now: NU,
  });

  assert.equal(beslut.ok, false);
  assert.equal(beslut.reason, 'för snart');
});

test('en körning med trasig tidsstämpel blockerar inte för alltid', () => {
  // Utan det här faller knappen död om GitHub skickar något oväntat.
  assert.equal(mayTrigger({ lastRun: { status: 'completed', createdAt: 'inte ett datum' }, now: NU }).ok, true);
  assert.equal(mayTrigger({ lastRun: { status: 'completed' }, now: NU }).ok, true);
});

test('spärren är tio minuter', () => {
  // Programmen ändras i dagsskala. Att skanna oftare belastar scenernas sidor
  // utan att göra listan bättre.
  assert.equal(COOLDOWN_MINUTER, 10);
});

test('nycklar jämförs på hela längden', () => {
  assert.equal(secretsEqual('hemlig', 'hemlig'), true);
  assert.equal(secretsEqual('hemlig', 'hemligt'), false);
  assert.equal(secretsEqual('hemlig', 'HEMLIG'), false);
  assert.equal(secretsEqual('hemlig', 'hemlig '), false);
});

test('tom eller saknad nyckel godtas aldrig', () => {
  // Saknas SCAN_TRIGGER_KEY i miljön ska knappen vara avstängd, inte öppen.
  // Utan den här raden hade en tom miljövariabel släppt in vem som helst.
  assert.equal(secretsEqual('', ''), false);
  assert.equal(secretsEqual(null, null), false);
  assert.equal(secretsEqual(undefined, 'hemlig'), false);
  assert.equal(secretsEqual('hemlig', null), false);
});

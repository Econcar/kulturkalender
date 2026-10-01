import test from 'node:test';
import assert from 'node:assert/strict';

import { runScan } from '../scanner/run.mjs';

/** En databas som bara räknar. Inget nät, ingen fil. */
const räknare = () => {
  const skrivna = [];
  return {
    skrivna,
    dryRun: true,
    startRun: async () => async () => {},
    upsertEvents: async (rader) => {
      skrivna.push(...rader);
      return rader.length;
    },
  };
};

const källa = (id, fetchEvents) => ({ id, label: id, fetchEvents });
const EN_RAD = [{ title: 'x', starts_at: '2026-10-01T18:00:00Z', external_id: '1' }];

test('en trasig källa gör körningen röd, men de andra skrivs ändå', async (t) => {
  t.after(() => { process.exitCode = 0; });
  const db = räknare();

  const resultat = await runScan({
    client: db,
    sources: [
      källa('hel', async () => EN_RAD),
      källa('trasig', async () => { throw new Error('sidan ändrad'); }),
    ],
  });

  assert.equal(process.exitCode, 1);
  assert.equal(db.skrivna.length, 1);
  assert.equal(resultat.sources.find((r) => r.source === 'trasig').status, 'error');
});

test('en källa som plötsligt ger noll gör också körningen röd', async (t) => {
  // Den vanligaste formen av trasig adapter: sajten har lagt om, inget kastas,
  // och listan är bara tom. Det ska larma lika mycket som ett fel.
  t.after(() => { process.exitCode = 0; });

  await runScan({
    client: räknare(),
    sources: [källa('hel', async () => EN_RAD), källa('tom', async () => [])],
  });

  assert.equal(process.exitCode, 1);
});

test('när allt går bra är körningen grön', async (t) => {
  t.after(() => { process.exitCode = 0; });
  process.exitCode = 0;

  await runScan({ client: räknare(), sources: [källa('hel', async () => EN_RAD)] });

  assert.equal(process.exitCode, 0);
});

test('en källa som tappar mer än hälften gör körningen röd, men skrivs ändå', async (t) => {
  // Dramaten från 390 till 12: inget kastas, inget är noll, men något är fel.
  t.after(() => { process.exitCode = 0; });
  const db = { ...räknare(), förraAntal: async () => 390 };
  const resultat = await runScan({ client: db, sources: [källa('dramaten', async () => EN_RAD)] });
  assert.equal(process.exitCode, 1);
  assert.equal(resultat.sources[0].status, 'error');
  assert.match(resultat.sources[0].error, /390/);
  assert.equal(db.skrivna.length, 1);
});

test('tapplarmet: bara över 20 rader förra gången, och bara under hälften', async () => {
  const { tappade } = await import('../scanner/run.mjs');
  assert.ok(tappade(390, 12));
  assert.equal(tappade(390, 300), null, 'en vanlig minskning larmade');
  assert.equal(tappade(6, 2), null, 'ett litet hus larmade');
  assert.equal(tappade(null, 2), null, 'larmade utan jämförelse');
});

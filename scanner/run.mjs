#!/usr/bin/env node
// Skannermotorn. Körs av GitHub Actions (.github/workflows/scan.yml) och lokalt
// med `npm run scan`. Kör källorna en i taget, isolerat: en trasig källa får
// aldrig fälla hela jobbet.
//
// Ärvd från leasingskannern, som hade exakt det här problemet: tio källor där
// en ändrar sitt sidformat varje kvartal. Skillnaden nu är att källorna är
// ojämna redan från start – se scanner/sources/_template.mjs.

import { selectSources } from './sources/index.mjs';
import { dedupeBatch } from './lib/dedupe.mjs';
import { createClient } from './lib/supabase.mjs';
import { createFileClient } from './lib/filesink.mjs';

const log = (...args) => console.log(...args);

/** `--out data/events.json` skriver till fil i stället för till Supabase. */
export function outPath(argv = process.argv) {
  const i = argv.indexOf('--out');
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

export async function runScan({ sourceFilter = process.env.SCAN_SOURCES, client, sources: override } = {}) {
  const sources = override ?? selectSources(sourceFilter);

  // Kolla källorna före klienten – utan adaptrar finns inget att skriva, och
  // då ska jobbet inte falla på saknade Supabase-variabler.
  if (!sources.length) {
    log('Inga aktiva källor registrerade – se scanner/sources/index.mjs.');
    return { sources: [], totalUpserted: 0, failures: 0 };
  }

  const fil = outPath();
  const db = client ?? (fil ? createFileClient(fil) : createClient());

  const läge = db.dryRun ? ' (DRY RUN)' : (db.path ? ` → ${db.path}` : '');
  log(`Startar skanning av ${sources.length} källa/källor${läge}.`);

  const results = [];
  for (const source of sources) {
    results.push(await runSource(source, db));
  }

  const totalUpserted = results.reduce((sum, r) => sum + r.rows_upserted, 0);
  const failures = results.filter((r) => r.status === 'error').length;
  const empty = results.filter((r) => r.status === 'empty').map((r) => r.source);

  log('---');
  for (const r of results) {
    log(`${r.status.padEnd(5)} ${r.source}: ${r.rows_found} hittade, ${r.rows_upserted} skrivna${r.error ? ` – ${r.error}` : ''}`);
  }
  if (empty.length) log(`VARNING: källor utan träffar (formatet kan ha ändrats): ${empty.join(', ')}`);

  // Exit-koden signalerar bara totalhaveri – enskilda trasiga källor är väntat
  // och syns i loggen och i scan_runs.
  if (failures === results.length) {
    log('Alla källor misslyckades.');
    process.exitCode = 1;
  }

  return { sources: results, totalUpserted, failures };
}

async function runSource(source, db) {
  log(`\n▶ ${source.label ?? source.id}`);
  const finish = await db.startRun(source.id);
  const result = { source: source.id, status: 'ok', rows_found: 0, rows_upserted: 0, error: null };

  try {
    const raw = await source.fetchEvents({ log });
    result.rows_found = raw.length;

    const rows = dedupeBatch(raw.map((event) => ({ ...event, source: source.id })));

    const dropped = raw.length - rows.length;
    if (dropped > 0) log(`  ${dropped} rader föll bort (dubbletter eller saknat external_id)`);

    if (!rows.length) {
      result.status = 'empty';
    } else {
      result.rows_upserted = await db.upsertEvents(rows);
    }
  } catch (err) {
    result.status = 'error';
    result.error = err?.message ?? String(err);
    log(`  FEL: ${result.error}`);
  }

  await finish(result);
  return result;
}

// Kör bara när filen startas direkt, inte när testerna importerar den.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('run.mjs')) {
  runScan().catch((err) => {
    console.error('Oväntat fel i skannern:', err);
    process.exitCode = 1;
  });
}

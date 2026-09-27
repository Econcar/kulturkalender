#!/usr/bin/env node
// Skannermotorn. Körs av GitHub Actions (.github/workflows/scan.yml) och lokalt
// med `npm run scan`. Kör källorna en i taget, isolerat: en trasig källa får
// aldrig fälla hela jobbet.
//
// Ärvd från leasingskannern, som hade exakt det här problemet: tio källor där
// en ändrar sitt sidformat varje kvartal. Skillnaden nu är att källorna är
// ojämna redan från start – se scanner/sources/_template.mjs.

import { appendFile } from 'node:fs/promises';

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

  await sammanfattning(results);

  // Varje trasig eller tom källa fäller körningen, inte bara totalhaveri.
  //
  // Förr signalerade exit-koden bara att ALLA källor misslyckats, med
  // motiveringen att enskilda trasiga källor syns i loggen. Men ingen läser
  // loggen en natt då allt ser grönt ut. Med tolv adaptrar mot tolv sajter
  // som när som helst kan lägga om sina sidor hade en scen kunnat tappa hela
  // sitt program utan att något larmade. En röd körning ger ett mejl från
  // GitHub; en grön ger ingenting.
  //
  // De andra källornas rader är redan skrivna när det här avgörs - en trasig
  // källa stoppar aldrig de andra, den gör bara körningen röd.
  const trasiga = results.filter((r) => r.status !== 'ok');
  if (trasiga.length) {
    log(trasiga.length === results.length
      ? 'Alla källor misslyckades.'
      : `${trasiga.length} av ${results.length} källor behöver tittas på: ${trasiga.map((r) => r.source).join(', ')}`);
    process.exitCode = 1;
  }

  return { sources: results, totalUpserted, failures };
}

/**
 * En tabell på körningens sida i GitHub, så att det syns utan att läsa
 * loggen vilken scen som fallerade och varför. GITHUB_STEP_SUMMARY finns bara
 * i Actions; lokalt händer ingenting.
 */
async function sammanfattning(results) {
  const fil = process.env.GITHUB_STEP_SUMMARY;
  if (!fil) return;
  const ikon = { ok: '✅', empty: '⚠️', error: '❌' };
  const rader = results.map((r) => `| ${ikon[r.status] ?? r.status} | ${r.source} | ${r.rows_found} | ${r.rows_upserted} | ${String(r.error ?? (r.status === 'empty' ? 'inga träffar - formatet kan ha ändrats' : '')).replace(/\|/g, '/').slice(0, 200)} |`);
  const text = ['| | Källa | Hittade | Skrivna | Fel |', '| --- | --- | ---: | ---: | --- |', ...rader, ''].join('\n');
  try {
    await appendFile(fil, text);
  } catch {
    // Sammanfattningen är en bekvämlighet och får aldrig fälla körningen.
  }
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
      // En arena med ett par konserter om året är tom de flesta veckor, och
      // det är inget formatbyte. Källor som vet det om sig själva säger
      // kanVaraTom och larmar inte på noll.
      result.status = source.kanVaraTom ? 'ok' : 'empty';
    } else {
      result.rows_upserted = await db.upsertEvents(rows);
    }
  } catch (err) {
    result.status = 'error';
    result.error = err?.message ?? String(err);
    log(`  FEL: ${result.error}`);

    // Kroppen och svarshuvudena, när felet kom från ett HTTP-svar.
    //
    // Ett statusnummer räcker inte när felet kommer från ett API bakom en
    // proxy: "HTTP 500" kan vara gatewayen, lastbalanseraren eller
    // applikationen bakom dem, och de kräver helt olika åtgärder. Huvudena
    // säger vem som svarade. Det här kostade en kväll att lista ut en gång.
    if (err?.body) log(`  svar: ${String(err.body).slice(0, 300)}`);
    if (err?.headers && Object.keys(err.headers).length) {
      log(`  huvuden: ${JSON.stringify(err.headers)}`);
    }
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

// Har public/ ändrats utan att versionen höjts?
//
// Service workern visar sidans filer ur cachen tills CACHE_VERSION byts. En
// ändring i public/ utan höjning når därför aldrig den som besökt sidan förut
// - den ligger på servern men visas inte, och inget fel syns någonstans.
// Höjningen var en sak att komma ihåg. Nu stoppar pre-push-spärren pushen.
//
// Uppdelad i en ren del, som testas, och en som frågar git.

import { spawnSync } from 'node:child_process';

/** Filerna som inte själva kräver en höjning: det är där höjningen görs. */
const VERSIONSFILER = new Set(['public/version.js', 'public/sw.js']);

/**
 * Felet, eller null. ändrade är filerna som ändrats sedan fjärrgrenen,
 * versionHöjd om public/version.js är en av dem.
 */
export function versionsfel(ändrade, versionHöjd) {
  const sidan = ändrade.filter((f) => f.startsWith('public/') && !VERSIONSFILER.has(f));
  if (!sidan.length || versionHöjd) return null;
  return `public/ har ändrats (${sidan.join(', ')}) men VERSION i public/version.js är densamma. `
    + 'Höj den i public/version.js och public/sw.js - annars får den som besökt sidan förut aldrig ändringen.';
}

/** Samma fråga mot git: det som pushas är allt mellan fjärrgrenen och HEAD. */
export function kollaVersion(rot) {
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: rot, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  // Utan fjärrgren - första pushen av en ny gren - finns inget att jämföra med.
  const bas = git(['rev-parse', '--verify', '-q', '@{u}']);
  if (!bas) return true;
  const ändrade = (git(['diff', '--name-only', `${bas}..HEAD`]) ?? '').split('\n').filter(Boolean);
  return versionsfel(ändrade, ändrade.includes('public/version.js')) ?? true;
}

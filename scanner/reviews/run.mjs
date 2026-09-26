#!/usr/bin/env node
// Läser kultursektionernas flöden, kopplar recensionerna till våra
// uppsättningar och sparar de matchade i reviews-tabellen.
//
// Veckan av insamling utan databas (20-26 september) svarade på frågan den
// skulle: Stockholms fyra hus recenseras sällan - en matchning på sju dagar,
// Parzival på Dramaten - men regeln missade ingen. Alla 35 omatchade
// recensioner gällde andra scener eller böcker. Tabellen byggdes för att
// flödena glömmer: en recension är borta ur dem inom någon vecka, långt innan
// pjäsen slutat spelas.
//
// Filen med allt körningen såg skrivs fortfarande. De omatchade är det enda
// stället där en för snäv regel syns.
//
// Körs av .github/workflows/reviews.yml varje natt. Utan Supabase-nycklar, och
// med --local, skrivs bara filen.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { FLÖDEN } from '../../lib/feeds.mjs';
import { parseFeed } from '../../lib/rss.mjs';
import { matchReview, parseReviewUrl, reviewRow } from '../../lib/review-match.mjs';
import { upcomingEvents, upcomingProductions } from '../../lib/upcoming.mjs';
import { createClient } from '../lib/supabase.mjs';


const SIDA = 'https://receptbok.pages.dev';
const UT = 'data/reviews.json';

const log = (...delar) => console.log(...delar);

async function main() {
  const lokalt = process.argv.includes('--local');
  const ut = utPath() ?? UT;

  const uppsättningar = lokalt ? await lokalaUppsättningar() : await hämtaUppsättningar();
  log(`${uppsättningar.length} uppsättningar att matcha mot${lokalt ? ' (lokalt)' : ''}.`);
  if (!uppsättningar.length) {
    throw new Error('inga uppsättningar - utan dem säger en matchning ingenting');
  }

  const poster = [];
  for (const [publicist, url] of FLÖDEN) {
    try {
      if (!(await isAllowedByRobots(url))) {
        log(`  ${publicist}: robots.txt säger nej`);
        continue;
      }
      const flöde = parseFeed(await fetchText(url, { retries: 1 }));
      for (const post of flöde) poster.push({ ...post, publisher: publicist });
      log(`  ${publicist}: ${flöde.length} poster`);
    } catch (err) {
      // En tidning som strular ska inte fälla de andra.
      log(`  ${publicist}: ${err.message}`);
    }
    await sleep(1000);
  }

  const recensioner = poster.filter((p) => parseReviewUrl(p.url).isReview);
  const matchade = [];
  const omatchade = [];

  for (const r of recensioner) {
    const träff = matchReview(r, uppsättningar);
    if (träff) {
      const p = uppsättningar.find((u) => u.production_key === träff.production_key);
      matchade.push({
        ...r,
        match: träff,
        production: { title: p?.title, venue: p?.venue },
        row: reviewRow(r, träff, p),
      });
    } else {
      omatchade.push(r);
    }
  }

  rapport({ poster, recensioner, matchade, omatchade });

  // Databasen efter rapporten, så att loggen visar vad som hittades även när
  // skrivningen fallerar. Filen skrivs oavsett, och felet kastas först sist.
  let skrivfel = null;
  if (!lokalt && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const n = await createClient().upsertReviews(matchade.map((m) => m.row));
      log(`\n${n} recensioner sparade i databasen.`);
    } catch (err) {
      skrivfel = err;
      log(`\nKunde inte spara recensionerna: ${err.message}`);
    }
  } else {
    log('\nIngen databas - bara filen skrivs.');
  }

  // Mappen finns inte i en färsk checkout: data/ är gitignorerad. Utan det
  // här föll körningen på sista raden med ENOENT - efter att ha gjort allt
  // arbetet, och med tom artefakt som följd. Samma mönster som filesink.mjs.
  await mkdir(dirname(ut), { recursive: true });
  await writeFile(ut, `${JSON.stringify({
    collected_at: new Date().toISOString(),
    productions: uppsättningar.length,
    items: poster.length,
    reviews: recensioner.length,
    matched: matchade,
    unmatched: omatchade,
  }, null, 1)}\n`);
  log(`\nSkrivet till ${ut}.`);

  if (skrivfel) throw skrivfel;
}

function rapport({ poster, recensioner, matchade, omatchade }) {
  log('---');
  log(`${poster.length} poster, ${recensioner.length} recensioner, ${matchade.length} matchade.`);

  for (const m of matchade) {
    log(`\nMATCH  ${m.production.title} (${m.production.venue}) – ${m.match.confidence}`);
    log(`       ${m.title ?? ''}`);
    log(`       ${m.url}`);
  }

  // De omatchade är poängen med körningen. Är regeln för snäv syns det här,
  // och ingen annanstans.
  if (omatchade.length) {
    log(`\nOmatchade recensioner (${omatchade.length}):`);
    for (const r of omatchade) log(`  ${kort(r.url)}`);
  }
}

const kort = (url) => String(url).replace(/^https?:\/\/(www\.)?/, '').slice(0, 96);

/** Uppsättningarna från den publicerade sidan. Läsning, inga nycklar. */
async function hämtaUppsättningar() {
  const alla = [];
  const steg = 300;

  for (let offset = 0; offset < 2000; offset += steg) {
    const res = await fetchText(`${SIDA}/api/productions?limit=${steg}&offset=${offset}`);
    const data = JSON.parse(res);
    const sida = data.productions ?? [];
    alla.push(...sida);
    if (sida.length < steg) break;
    await sleep(500);
  }
  return alla;
}

/** Uppsättningarna ur den lokala skannerutdatan. Kräver npm run scan:local. */
async function lokalaUppsättningar() {
  const rader = JSON.parse(await readFile('data/events.json', 'utf8'));
  return upcomingProductions(upcomingEvents(rader));
}

function utPath(argv = process.argv) {
  const i = argv.indexOf('--out');
  return i === -1 ? null : argv[i + 1];
}

main().catch((err) => {
  console.error('Oväntat fel i recensionsläsningen:', err);
  process.exitCode = 1;
});

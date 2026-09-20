#!/usr/bin/env node
// Lokal utvecklingsserver. `npm run dev`.
//
// Serverar public/ och svarar på /api/events ur data/events.json, som
// `npm run scan:local` fyller. Finns för att Cloudflare Pages inte går att
// köra lokalt utan verktyg vi medvetet inte har beroenden till, och för att
// gränssnittet annars inte går att se förrän Supabase är uppsatt.
//
// Det här är ett titthål, inte en simulering. Det som skiljer mot drift:
//  - urvalet görs av lib/upcoming.mjs i JS, inte av SQL-vyn
//  - ingen cache, inga CORS-huvuden, ingen service worker som mellanhand
// Fälten är däremot desamma, och tests/upcoming.test.mjs vaktar det.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyFilters, upcomingEvents, upcomingProductions, venueSummary } from '../lib/upcoming.mjs';
import { FLÖDEN, publicistNamn } from '../lib/feeds.mjs';
import { parseFeed } from '../lib/rss.mjs';
import { matchReview, parseReviewUrl } from '../lib/review-match.mjs';

const rot = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(rot, 'public');
const DATA = join(rot, 'data', 'events.json');
const PORT = Number(process.env.PORT) || 8788;

const TYPER = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/events') return events(url, res);
  if (url.pathname === '/api/venues') return venues(res);
  if (url.pathname === '/api/productions') return productions(url, res);
  if (url.pathname === '/api/news') return news(res);
  if (url.pathname === '/api/scan') {
    // Knappen startar ett GitHub Actions-jobb, och det gör bara den utrullade
    // Pages Functionen. Ett tydligt svar är bättre än en 404 som ser ut som
    // ett stavfel.
    res.writeHead(501, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: 'Skanningsknappen finns bara i drift. Lokalt kör du npm run scan:local i stället.',
    }));
    return;
  }

  if (url.pathname === '/api/health') {
    return json(res, { ok: true, time: new Date().toISOString(), supabase_configured: false });
  }

  await statisk(url, res);
});

/**
 * Nyheterna. Motsvarar functions/api/news.js.
 *
 * Hämtar flödena på riktigt, precis som drift gör - det är ju där
 * matchningen kan visa sig vara fel, och en stubbe hade dolt just det.
 */
async function news(res) {
  const uppsättningar = upcomingProductions(upcomingEvents(await läsData()));
  const gräns = Date.now() - 14 * 86_400_000;

  const nya = uppsättningar
    .filter((p) => p.announced_at && new Date(p.announced_at).getTime() >= gräns)
    .sort((a, b) => String(b.announced_at).localeCompare(String(a.announced_at)))
    .slice(0, 40);

  const recensioner = [];
  for (const [publicist, adress] of FLÖDEN) {
    try {
      const svar = await fetch(adress);
      if (!svar.ok) continue;
      for (const post of parseFeed(await svar.text())) {
        if (!parseReviewUrl(post.url).isReview) continue;
        const träff = matchReview(post, uppsättningar);
        if (!träff) continue;
        const p = uppsättningar.find((u) => u.production_key === träff.production_key);
        recensioner.push({
          url: post.url, title: post.title, description: post.description,
          published: post.published, publisher: publicistNamn(publicist),
          confidence: träff.confidence,
          production: p && { production_key: p.production_key, title: p.title, venue: p.venue, url: p.url },
        });
      }
    } catch {
      // En tidning som inte svarar ska inte dölja nyheterna.
    }
  }

  json(res, { generated_at: new Date().toISOString(), days: 14, productions: nya, reviews: recensioner });
}

/** Uppsättningarna. Motsvarar vyn upcoming_productions. */
async function productions(url, res) {
  const p = url.searchParams;
  let rader = upcomingProductions(upcomingEvents(await läsData()));

  const venue = p.get('venue');
  if (venue) rader = rader.filter((r) => r.venue_slug === venue);

  const category = p.get('category');
  if (category) rader = rader.filter((r) => r.category === category);

  const q = (p.get('q') ?? '').toLowerCase();
  if (q.length >= 2) {
    rader = rader.filter((r) => `${r.title ?? ''} ${r.description ?? ''} ${r.venue ?? ''}`
      .toLowerCase()
      .includes(q));
  }

  const limit = Number(p.get('limit')) || 100;
  const offset = Number(p.get('offset')) || 0;
  const träffar = rader.slice(offset, offset + limit);

  json(res, { generated_at: new Date().toISOString(), count: träffar.length, productions: träffar });
}

async function venues(res) {
  // upcomingEvents först: vyn venue_summary räknar bara kommande, inte
  // inställda. Räknar man råraderna får husen med sig hela sin historik.
  const sammanställning = venueSummary(upcomingEvents(await läsData()));
  json(res, {
    generated_at: new Date().toISOString(),
    count: sammanställning.length,
    venues: sammanställning,
  });
}

async function läsData() {
  try {
    return JSON.parse(await readFile(DATA, 'utf8'));
  } catch {
    return [];
  }
}

async function events(url, res) {
  const p = url.searchParams;
  let rader;
  try {
    rader = JSON.parse(await readFile(DATA, 'utf8'));
  } catch {
    // Ingen fil ännu. Tom lista är rätt svar – sidan säger då själv att
    // skannern inte har körts, vilket är precis vad som har hänt.
    return json(res, { generated_at: new Date().toISOString(), count: 0, events: [] });
  }

  const träffar = applyFilters(upcomingEvents(rader), {
    category: p.get('category'),
    venue: p.get('venue'),
    from: p.get('from'),
    to: p.get('to'),
    q: p.get('q'),
    limit: Number(p.get('limit')) || 60,
    offset: Number(p.get('offset')) || 0,
  });

  json(res, { generated_at: new Date().toISOString(), count: träffar.length, events: träffar });
}

async function statisk(url, res) {
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  // normalize + strippade ../ så att en adress inte kan ta sig ur public/.
  const fil = join(PUBLIC, normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  try {
    const kropp = await readFile(fil);
    res.writeHead(200, { 'content-type': TYPER[extname(fil)] ?? 'application/octet-stream' });
    res.end(kropp);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Finns inte');
  }
}

function json(res, kropp) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(kropp));
}

server.listen(PORT, () => {
  console.log(`Kulturkalendern på http://localhost:${PORT}`);
  console.log(`Data ur ${DATA}`);
  console.log('Fyll den med: npm run scan:local');
});

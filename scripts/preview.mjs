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

import { applyFilters, upcomingEvents, venueSummary } from '../lib/upcoming.mjs';

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
  if (url.pathname === '/api/health') {
    return json(res, { ok: true, time: new Date().toISOString(), supabase_configured: false });
  }

  await statisk(url, res);
});

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

// Bläddringen förbi Supabases tak på 1000 rader per fråga.

import test from 'node:test';
import assert from 'node:assert/strict';

import { allaRader } from '../functions/api/_shared.js';

/** En falsk Supabase med n rader, som lämnar ut högst tak åt gången. */
function supabase(n, tak = 1000) {
  const frågor = [];
  const hämta = async (_env, path) => {
    frågor.push(path);
    const q = new URLSearchParams(path.split('?')[1]);
    const från = Number(q.get('offset'));
    const antal = Math.min(Number(q.get('limit')), tak);
    return Array.from({ length: Math.max(0, Math.min(antal, n - från)) }, (_, i) => ({ id: från + i }));
  };
  return { hämta, frågor };
}

test('alla rader kommer med, också över taket', async () => {
  const { hämta, frågor } = supabase(2345);
  const rader = await allaRader({}, 'upcoming_productions?select=*&order=production_key.asc', { hämta });
  assert.equal(rader.length, 2345);
  assert.equal(new Set(rader.map((r) => r.id)).size, 2345);
  assert.equal(frågor.length, 3);
});

test('färre än en sida är en fråga', async () => {
  const { hämta, frågor } = supabase(970);
  assert.equal((await allaRader({}, 'x?order=a.asc', { hämta })).length, 970);
  assert.equal(frågor.length, 1);
});

test('utan ordning vägrar den, för sidorna kan överlappa', async () => {
  await assert.rejects(() => allaRader({}, 'x?select=*', { hämta: async () => [] }), /order/);
});

test('ett tak på antal sidor, så att en loop inte kan bli oändlig', async () => {
  const { hämta } = supabase(10_000);
  await assert.rejects(() => allaRader({}, 'x?order=a.asc', { hämta, sida: 100, max: 5 }), /fler än 500/);
});

// --- Ändpunkterna mot en låtsad Supabase med 2500 uppsättningar ------------

/** Svarar som PostgREST, med taket på 1000 rader. Loggar frågorna. */
function låtsadSupabase({ uppsättningar, recensioner }) {
  const frågor = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    frågor.push(decodeURIComponent(u.pathname + u.search));
    const tabell = u.pathname.split('/').pop();
    let rader = { upcoming_productions: uppsättningar, reviews: recensioner, venue_summary: [] }[tabell] ?? [];
    const annonserad = u.searchParams.get('announced_at');
    if (annonserad) rader = rader.filter((p) => p.announced_at >= annonserad.replace(/^gte\./, ''));
    const från = Number(u.searchParams.get('offset') ?? 0);
    const antal = Math.min(Number(u.searchParams.get('limit') ?? 1000), 1000);
    return new Response(JSON.stringify(rader.slice(från, från + antal)), { status: 200 });
  };
  return { frågor, återställ: () => { globalThis.fetch = original; } };
}

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' };
const nu = Date.now();
const UPPSÄTTNINGAR = Array.from({ length: 2500 }, (_, i) => ({
  production_key: `zita|https://zita.se/filmer/film-${String(i).padStart(4, '0')}`,
  title: i === 2400 ? 'Digger' : `Film ${i}`,
  venue: 'Zita Folkets Bio',
  venue_slug: 'zita',
  category: 'film',
  url: `https://zita.se/filmer/film-${i}`,
  // De sista hundra är nya.
  announced_at: new Date(nu - (i >= 2400 ? 1 : 40) * 86_400_000).toISOString(),
  first_at: new Date(nu + 86_400_000).toISOString(),
}));

test('recensionerna hittar uppsättningar bortom de första tusen', async () => {
  const { onRequestGet } = await import('../functions/api/reviews.js');
  const db = låtsadSupabase({
    uppsättningar: UPPSÄTTNINGAR,
    recensioner: [{ url: 'https://svt.se/r', publisher: 'svt', production_key: 'film|digger', production_title: 'Digger', confidence: 'osäker', published_at: new Date(nu).toISOString() }],
  });
  try {
    const svar = await (await onRequestGet({ env: ENV })).json();
    assert.equal(svar.reviews[0].production.venue, 'Zita Folkets Bio');
    assert.deepEqual(svar.reviews[0].production.production_keys, [UPPSÄTTNINGAR[2400].production_key]);
  } finally {
    db.återställ();
  }
});

test('Nytt låter databasen gallra på annonseringsdag', async () => {
  const { onRequestGet } = await import('../functions/api/news.js');
  const db = låtsadSupabase({ uppsättningar: UPPSÄTTNINGAR, recensioner: [] });
  try {
    const svar = await (await onRequestGet({ env: ENV })).json();
    assert.equal(svar.productions.length, 40); // nyheter() visar högst 40
    assert.ok(svar.productions.every((p) => Number(p.title.split(' ')[1] ?? 2400) >= 2400 || p.title === 'Digger'));
    assert.ok(db.frågor.some((f) => /upcoming_productions\?select=\*&announced_at=gte\./.test(f)));
  } finally {
    db.återställ();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { reviewForPage, reviewRow } from '../lib/review-match.mjs';
import { productionKey as nyckelIVyn } from '../lib/upcoming.mjs';
import { productionKey, recensionerPerUppsättning, recensionsetikett } from '../public/format.js';
import { fetchReviews } from '../public/api.js';
import { createClient } from '../scanner/lib/supabase.mjs';

const PARZIVAL = {
  production_key: 'dramaten|https://www.dramaten.se/repertoar/parzival/',
  title: 'Parzival',
  venue: 'Dramaten',
  venue_slug: 'dramaten',
  category: 'teater',
  url: 'https://www.dramaten.se/repertoar/parzival/',
};

const POST = {
  url: 'https://www.aftonbladet.se/kultur/teater/a/M7Gv7B/recension-parzival-av-lukas-barfuss-pa-dramaten?utm_medium=rss',
  title: 'Kungen med jättepungen är den enda behållningen',
  description: 'ÅSA LINDERBORG ser en obegripligt svag ”Parzival” på Dramaten',
  published: 'Thu, 17 Sep 2026 10:40:42 GMT',
  publisher: 'aftonbladet',
};

test('en matchad recension blir en rad utan spårningskod', () => {
  const rad = reviewRow(POST, { production_key: PARZIVAL.production_key, confidence: 'hög' }, PARZIVAL);
  assert.equal(rad.url, 'https://www.aftonbladet.se/kultur/teater/a/M7Gv7B/recension-parzival-av-lukas-barfuss-pa-dramaten');
  assert.equal(rad.published_at, '2026-09-17T10:40:42.000Z');
  assert.equal(rad.production_title, 'Parzival');
  assert.equal(rad.venue_slug, 'dramaten');
  assert.equal(rad.category, 'teater');
  // Tabellen har en check på confidence och en på https - raden måste klara båda.
  assert.ok(['hög', 'osäker'].includes(rad.confidence));
  assert.match(rad.url, /^https:\/\//);
});

test('en recension av en pjäs som spelat klart behåller titel och hus', () => {
  const rad = reviewRow(POST, { production_key: PARZIVAL.production_key, confidence: 'hög' }, PARZIVAL);
  const sida = reviewForPage(rad, []);
  assert.equal(sida.publisher, 'Aftonbladet');
  assert.equal(sida.production.title, 'Parzival');
  assert.equal(sida.production.venue, 'Dramaten');
  assert.equal(sida.production.venue_slug, 'dramaten');
  // Kategorin ur ögonblicksbilden, så att kategorifiltret i recensionsvyn
  // hittar den även när pjäsen inte längre spelas.
  assert.equal(sida.production.category, 'teater');
});

test('sidan och vyn räknar ut samma uppsättningsnyckel', () => {
  const rader = [
    { source: 'dramaten', url: 'https://www.dramaten.se/repertoar/parzival/', title: 'Parzival' },
    { source: 'konserthuset', external_id: 'kalender-2026-10-01/1234', url: 'https://x', title: 'Konsert' },
    { source: 'kulturhuset', url: null, title: 'Utan adress' },
    { source: 'operan', url: 'https://www.operan.se/tosca', title: 'Tosca' },
    { title: 'Utan källa' },
  ];
  for (const r of rader) assert.equal(productionKey(r), nyckelIVyn(r), JSON.stringify(r));
});

test('recensionerna grupperas per uppsättning, nyast först', () => {
  const äldre = { url: 'https://a', published: '2026-09-10T00:00:00Z', production: { production_key: 'k' } };
  const nyare = { url: 'https://b', published: '2026-09-17T00:00:00Z', production: { production_key: 'k' } };
  const per = recensionerPerUppsättning([äldre, nyare, { url: 'https://c', production: null }]);
  assert.deepEqual(per.get('k').map((r) => r.url), ['https://b', 'https://a']);
  assert.equal(per.size, 1);
});

test('etiketten på kortet är tidning och dag', () => {
  assert.equal(recensionsetikett({ publisher: 'Aftonbladet', published: '2026-09-17T10:40:42Z' }), 'Aftonbladet 17 september');
  assert.equal(recensionsetikett({ publisher: 'SvD', published: null }), 'SvD');
});

test('sidan fungerar utan recensioner när ändpunkten fallerar', async () => {
  assert.deepEqual(await fetchReviews({ fetchImpl: async () => { throw new Error('nere'); } }), []);
  assert.deepEqual(await fetchReviews({
    fetchImpl: async () => new Response('{"error":"x"}', { status: 502, headers: { 'content-type': 'application/json' } }),
  }), []);
});

test('recensionerna upsertas på url, utan first_seen_at', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let anrop;
  globalThis.fetch = async (url, init) => {
    anrop = { url, body: JSON.parse(init.body) };
    return new Response(null, { status: 201 });
  };

  const db = createClient({ url: 'https://exempel.supabase.co', serviceKey: 'nyckel' });
  const rad = reviewRow(POST, { production_key: PARZIVAL.production_key, confidence: 'hög' }, PARZIVAL);
  assert.equal(await db.upsertReviews([rad]), 1);
  assert.equal(anrop.url, 'https://exempel.supabase.co/rest/v1/reviews?on_conflict=url');
  // first_seen_at ska stå kvar från första natten - skickas den skrivs den över.
  assert.ok(!('first_seen_at' in anrop.body[0]));
  assert.ok(anrop.body[0].last_seen_at);
});

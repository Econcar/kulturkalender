import test from 'node:test';
import assert from 'node:assert/strict';

import { buildQuery, fetchEvents, fetchVenues, parseResponse } from '../public/api.js';

/** Ett minimalt svar med bara det parseResponse tittar på. */
const svar = ({ ok = true, status = 200, type = 'application/json; charset=utf-8', body = { events: [] } } = {}) => ({
  ok,
  status,
  headers: { get: (namn) => (namn.toLowerCase() === 'content-type' ? type : null) },
  json: async () => {
    if (body instanceof Error) throw body;
    return body;
  },
});

test('tomma filter kommer inte med i frågan', () => {
  assert.equal(buildQuery(), 'limit=60');
  assert.equal(buildQuery({ category: '', q: '', offset: 0 }), 'limit=60');
});

test('satta filter kommer med', () => {
  const q = new URLSearchParams(buildQuery({ category: 'teater', q: 'Molière', offset: 60, limit: 20 }));
  assert.equal(q.get('limit'), '20');
  assert.equal(q.get('category'), 'teater');
  assert.equal(q.get('q'), 'Molière');
  assert.equal(q.get('offset'), '60');
});

test('HTML i stället för JSON ger ett begripligt fel', async () => {
  // Det verkliga läget: Cloudflare Pages faller tillbaka på index.html för
  // okända sökvägar, så en Function som inte deployats svarar 200 med HTML.
  // Utan den här kontrollen säger sidan "Unexpected token '<'".
  await assert.rejects(
    () => parseResponse(svar({ type: 'text/html; charset=utf-8' })),
    /Pages Function utrullad/,
  );
});

test('felkod nämns i felet', async () => {
  await assert.rejects(() => parseResponse(svar({ ok: false, status: 502 })), /502/);
});

test('trasig JSON skiljs från fel innehållstyp', async () => {
  await assert.rejects(
    () => parseResponse(svar({ body: new SyntaxError('oväntat tecken') })),
    /trasig JSON/,
  );
});

test('ett svar utan events-lista avvisas', async () => {
  await assert.rejects(() => parseResponse(svar({ body: { count: 0 } })), /events-lista/);
  await assert.rejects(() => parseResponse(svar({ body: null })), /events-lista/);
});

test('ett giltigt svar släpps igenom', async () => {
  const data = await parseResponse(svar({ body: { count: 1, events: [{ title: 'Parzival' }] } }));
  assert.equal(data.events[0].title, 'Parzival');
});

test('scenfiltret kommer med i frågan', () => {
  const q = new URLSearchParams(buildQuery({ venue: 'dramaten' }));
  assert.equal(q.get('venue'), 'dramaten');
  assert.equal(new URLSearchParams(buildQuery({ venue: '' })).get('venue'), null);
});

test('husen hämtas som en egen lista', async () => {
  let hämtad = null;
  const venues = await fetchVenues({
    fetchImpl: async (url) => {
      hämtad = url;
      return svar({ body: { venues: [{ slug: 'dramaten', name: 'Dramaten', upcoming_count: 442 }] } });
    },
  });

  assert.equal(hämtad, '/api/venues');
  assert.equal(venues[0].name, 'Dramaten');
});

test('faller huslistan bort fungerar sidan ändå', async () => {
  // Listan är en upplysning, inte en förutsättning för att läsa evenemangen.
  // Att fälla hela sidan på den vore att låta det mindre viktiga stoppa det
  // viktiga.
  assert.deepEqual(await fetchVenues({ fetchImpl: async () => { throw new Error('nätet nere'); } }), []);
  assert.deepEqual(await fetchVenues({ fetchImpl: async () => svar({ ok: false, status: 502 }) }), []);
  assert.deepEqual(await fetchVenues({ fetchImpl: async () => svar({ type: 'text/html' }) }), []);
  assert.deepEqual(await fetchVenues({ fetchImpl: async () => svar({ body: { fel: 1 } }) }), []);
});

test('fetchEvents sätter ihop adressen och läser svaret', async () => {
  let hämtad = null;
  const data = await fetchEvents({ category: 'konsert' }, {
    limit: 10,
    fetchImpl: async (url) => { hämtad = url; return svar({ body: { events: [] } }); },
  });

  assert.equal(hämtad, '/api/events?limit=10&category=konsert');
  assert.deepEqual(data.events, []);
});

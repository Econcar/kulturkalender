import test from 'node:test';
import assert from 'node:assert/strict';

import { buildQuery, fetchEvents, parseResponse } from '../public/api.js';

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

test('fetchEvents sätter ihop adressen och läser svaret', async () => {
  let hämtad = null;
  const data = await fetchEvents({ category: 'konsert' }, {
    limit: 10,
    fetchImpl: async (url) => { hämtad = url; return svar({ body: { events: [] } }); },
  });

  assert.equal(hämtad, '/api/events?limit=10&category=konsert');
  assert.deepEqual(data.events, []);
});

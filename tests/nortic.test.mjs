import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import källor, { egnaSidor, eventsFromNortic, norticIds } from '../scanner/sources/nortic.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SIDA = readFileSync(join(here, 'fixtures', 'nortic-evenemang.html'), 'utf8');

const stockholm = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

test('en rad per föreställning, i svensk tid', () => {
  const rader = eventsFromNortic(SIDA, '85550', /giljotin/i);
  assert.equal(rader.length, 4);
  assert.equal(stockholm(rader[0].starts_at), '2026-10-07 19:00:00');
  assert.equal(rader[0].title, 'Agent 08 - med rätt attityd');
});

test('ett slutdatum utan klockslag före starten kastas', () => {
  // "endDate": "2026-10-07" är midnatt, alltså före 19:00. Databasen avvisar
  // en sådan rad, och hela källans skrivning hade fallit med den.
  for (const rad of eventsFromNortic(SIDA, '85550', /giljotin/i)) {
    assert.ok(rad.ends_at === null || rad.ends_at >= rad.starts_at);
  }
});

test('genren i hakparentes blir kategori och tas ur beskrivningen', () => {
  const [rad] = eventsFromNortic(SIDA, '85550', /giljotin/i);
  assert.equal(rad.category, 'teater');
  assert.ok(!rad.description?.startsWith('['));
});

test('bilden är den sista adressen i det ihopklistrade fältet', () => {
  const [rad] = eventsFromNortic(SIDA, '85550', /giljotin/i);
  assert.match(rad.image_url, /^https:\/\/branding\.nortic\.io\//);
});

test('föreställningar på en annan scen sorteras bort', () => {
  assert.equal(eventsFromNortic(SIDA, '85550', /strindberg/i).length, 0);
});

test('id:t är evenemanget och tiden', () => {
  const ids = eventsFromNortic(SIDA, '85550', /giljotin/i).map((r) => r.external_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith('85550/')));
});

test('Nortic-länkar hittas oavsett värd', () => {
  const html = 'href="https://tickets.nortic.se/ticket/event/76364" href="https://www.nortic.se/ticket/event/70448" href="https://nortic.se/ticket/event/70448"';
  assert.deepEqual(norticIds(html), ['76364', '70448']);
});

test('teaterns egna sidor, utan arkiv och kontakt', () => {
  const html = 'href="/avgrunden" href="/2024" href="/arkiv-1" href="/kontakt-1" href="/new-page-5" href="/avgrunden"';
  const sidor = egnaSidor(html, 'https://x.se', /^\/(\d|arkiv|kontakt)/);
  assert.deepEqual(sidor, ['https://x.se/avgrunden', 'https://x.se/new-page-5']);
});

test('hela kedjan utan nät', async () => {
  const giljotin = källor.find((k) => k.id === 'giljotin');
  const rader = await giljotin.fetchEvents({
    log: () => {},
    paus: async () => {},
    robotsOk: async () => true,
    hämta: async (url) => {
      if (url === 'https://www.teatergiljotin.se/') return '<a href="/agent-08">Agent 08</a>';
      if (url === 'https://www.teatergiljotin.se/agent-08') return '<a href="https://nortic.se/ticket/event/85550">Biljetter</a>';
      if (url === 'https://www.nortic.se/ticket/event/85550') return SIDA;
      throw new Error(`404 ${url}`);
    },
  });
  assert.equal(rader.length, 4);
});

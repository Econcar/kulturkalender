import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import folkoperan, { media, performances, productions, toRows } from '../scanner/sources/folkoperan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const LISTA = readFileSync(join(here, 'fixtures', 'folkoperan-lista.html'), 'utf8');

const stockholm = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

const UPPSÄTTNINGAR = JSON.stringify([
  { title: { rendered: 'Jag är Ulla Winblad' }, link: 'https://folkoperan.se/uppsattningar/jag-ar-ulla-winblad/', featured_media: 7 },
  { title: { rendered: 'Vem fan gillar opera?' }, link: 'https://folkoperan.se/uppsattningar/vem-fan-gillar-opera/', featured_media: 0 },
  { title: { rendered: 'Jag' }, link: 'https://folkoperan.se/uppsattningar/jag/', featured_media: 0 },
]);

test('kvällarna som står i båda listorna blir en rad var', () => {
  const f = performances(LISTA);
  const nycklar = f.map((x) => `${x.title}|${x.starts_at}`);
  assert.equal(new Set(nycklar).size, nycklar.length);
  assert.equal(f.filter((x) => x.title === 'Jag är Ulla Winblad').length, 2);
});

test('datum och klockslag läses i svensk tid', () => {
  const ulla = performances(LISTA).filter((x) => x.title === 'Jag är Ulla Winblad');
  assert.deepEqual(ulla.map((x) => stockholm(x.starts_at)).sort(), ['2026-09-26 18:00:00', '2026-09-30 18:00:00']);
});

test('PREMIÄR tas ur titeln och blir uppsättningens premiärdatum', () => {
  const rader = toRows(performances(LISTA));
  const vem = rader.find((r) => r.title === 'Vem fan gillar opera?');
  assert.ok(vem, 'titeln bar kvar PREMIÄR');
  assert.equal(vem.premiere_at, vem.starts_at);
});

test('en utsåld kväll utan biljettlänk får ändå ett id av titel och tid', () => {
  // Länken försvinner när kvällen säljer slut. Ett id byggt på länken hade
  // gett samma föreställning ett nytt id, och en dubblett.
  const rader = toRows(performances(LISTA));
  const utsåld = rader.find((r) => r.title === 'Jag är Ulla Winblad' && !r.ticket_url);
  assert.ok(utsåld);
  assert.equal(utsåld.external_id, 'jag-ar-ulla-winblad/202609261600');
});

test('föreställningen länkar till sin uppsättning, den längsta titeln vinner', () => {
  const bilder = media('[{"id":7,"source_url":"https://folkoperan.se/bild.png"}]');
  const rader = toRows(performances(LISTA), productions(UPPSÄTTNINGAR), bilder);
  const ulla = rader.find((r) => r.title === 'Jag är Ulla Winblad');
  assert.equal(ulla.url, 'https://folkoperan.se/uppsattningar/jag-ar-ulla-winblad/');
  assert.equal(ulla.image_url, 'https://folkoperan.se/bild.png');
});

test('opera som standard, konsert när titeln säger det', () => {
  const rader = toRows(performances(LISTA));
  assert.equal(rader.find((r) => r.title.startsWith('Jag är')).category, 'opera');
  assert.equal(rader.find((r) => /Jazz Festival/.test(r.title)).category, 'konsert');
});

test('utan uppsättningar länkar kvällen till biljettsidan', () => {
  const rader = toRows(performances(LISTA));
  assert.ok(rader.every((r) => r.url === 'https://folkoperan.se/kop-biljetter/'));
});

test('hela kedjan utan nät, också när API:et är nere', async () => {
  const rader = await folkoperan.fetchEvents({
    log: () => {},
    paus: async () => {},
    robotsOk: async () => true,
    hämta: async (url) => {
      if (url === 'https://folkoperan.se/kop-biljetter/') return LISTA;
      throw new Error(`503 ${url}`);
    },
  });
  assert.ok(rader.length >= 4);
  assert.ok(rader.every((r) => r.external_id && r.starts_at && r.title));
});

import test from 'node:test';
import assert from 'node:assert/strict';

import källor, { arenaId, kategori, sanityBild, showsById, toRow } from '../scanner/sources/showtic.mjs';

const stockholm = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

// Ur /api/events/venue för China Teatern, 2026-09-26.
const FÖRESTÄLLNING = {
  _id: '4a19597b-f4cd-4855-b3dd-7d561cfeb475',
  dateAndTime: '2026-09-26T18:00:00.000Z',
  image: null,
  minPrice: 395,
  name: '[Mia, myself and I – Sista måltiden] 2026-09-26 China Teatern',
  promoter: null,
  saleStatus: 'releasedForSale',
  show: {
    _id: '324fb19c-934b-4abc-8253-8349d40ea9da',
    hideEventPrices: null,
    spotImage: { asset: { _ref: 'image-7ff03d0afe23671f1c1da048ffa9e28138df0d67-1080x1080-jpg' } },
    title: 'Mia, myself and I – Sista måltiden',
  },
  ticketPrice: 395,
  ticketUrl: 'https://shop.showtic.se/unnhebk5r3y4nrw',
};

const SHOWER = JSON.stringify({
  data: [{
    _id: '324fb19c-934b-4abc-8253-8349d40ea9da',
    slug: { current: 'mia-myself-and-i-sista-maltiden' },
    genres: [{ name: 'Komedi' }],
    secondaryGenres: [{ name: 'Show' }],
    preamble: 'Häng med när Mia Skäringer ska bjuda in till 50 årsfest.',
  }],
  metadata: { total: 1 },
});

test('tiden är UTC och blir svensk tid', () => {
  // Kontrollerat mot China Teaterns egen sida: "Lördag 26 sep, 20:00".
  const rad = toRow(FÖRESTÄLLNING, showsById(SHOWER), 'china-teatern');
  assert.equal(stockholm(rad.starts_at), '2026-09-26 20:00:00');
});

test('showen ger kategori, ingress och egen sida', () => {
  const rad = toRow(FÖRESTÄLLNING, showsById(SHOWER), 'china-teatern');
  assert.equal(rad.category, 'humor');
  assert.equal(rad.url, 'https://showtic.se/evenemangskalender/mia-myself-and-i-sista-maltiden');
  assert.match(rad.description, /Mia Skäringer/);
  assert.equal(rad.external_id, FÖRESTÄLLNING._id);
  assert.equal(rad.price_min, 395);
});

test('utan showerna finns raden ändå, som övrigt och med arenasidan som länk', () => {
  const rad = toRow(FÖRESTÄLLNING, new Map(), 'china-teatern');
  assert.equal(rad.category, 'övrigt');
  assert.equal(rad.url, 'https://showtic.se/arenor/china-teatern/');
  assert.equal(rad.title, 'Mia, myself and I – Sista måltiden');
});

test('dolda priser visas inte', () => {
  const rad = toRow({ ...FÖRESTÄLLNING, show: { ...FÖRESTÄLLNING.show, hideEventPrices: true } });
  assert.equal(rad.price_min, null);
});

test('huvudgenren vinner över den sekundära', () => {
  assert.equal(kategori(['Konsert', 'Show']), 'konsert');
  assert.equal(kategori(['Musikal']), 'opera');
  assert.equal(kategori(['Familjeteater']), 'barn');
  assert.equal(kategori(['Okänd genre']), 'övrigt');
});

test('bildreferensen blir en adress hos Sanity', () => {
  assert.equal(
    sanityBild('image-7ff03d0afe23671f1c1da048ffa9e28138df0d67-1080x1080-jpg'),
    'https://cdn.sanity.io/images/3553xkck/production/7ff03d0afe23671f1c1da048ffa9e28138df0d67-1080x1080.jpg?w=800',
  );
  assert.equal(sanityBild(undefined), null);
});

test('husets id läses ur arenasidan', () => {
  const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"venue":{"_id":"abc"}}}}</script>';
  assert.equal(arenaId(html), 'abc');
  assert.equal(arenaId('<html></html>'), null);
});

test('fler än 100 föreställningar hämtas i flera sidor', async () => {
  const [china] = källor;
  const anrop = [];
  const rader = await china.fetchEvents({
    log: () => {},
    paus: async () => {},
    robotsOk: async () => true,
    hämta: async (url) => {
      anrop.push(url);
      if (url.includes('/arenor/')) return '<script id="__NEXT_DATA__">{"props":{"pageProps":{"venue":{"_id":"v1"}}}}</script>';
      if (url.includes('/api/shows')) return SHOWER;
      const skip = Number(new URL(url).searchParams.get('skip'));
      const antal = skip === 0 ? 100 : 8;
      const data = Array.from({ length: antal }, (_, i) => ({ ...FÖRESTÄLLNING, _id: `id-${skip + i}` }));
      return JSON.stringify({ data, metadata: { total: 108 } });
    },
  });
  assert.equal(rader.length, 108);
  assert.equal(anrop.filter((u) => u.includes('/api/events/venue')).length, 2);
});

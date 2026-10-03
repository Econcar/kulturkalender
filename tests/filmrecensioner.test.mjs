// Filmrecensioner: filmen och inte biografen, eftersom adressen aldrig nämner
// huset. Adresserna är avskrivna ur Nöjesbladets flöde 2026-10-03.

import test from 'node:test';
import assert from 'node:assert/strict';

import { filmnyckel, matchFilmReview, matchReview, reviewForPage, reviewRow } from '../lib/review-match.mjs';
import { filtreraNytt, recensionerPerUppsättning } from '../public/format.js';

const NB = 'https://www.aftonbladet.se/nojesbladet/film/a';

const uppsättning = (slug, venue, title, extra = {}) => ({
  production_key: `${slug}|https://${slug}.se/${filmnyckel(title)}`,
  venue_slug: slug,
  venue,
  title,
  category: 'film',
  first_at: '2026-10-04T16:00:00Z',
  last_at: '2026-10-11T18:00:00Z',
  url: `https://${slug}.se/${filmnyckel(title)}`,
  ...extra,
});

const REPERTOAR = [
  uppsättning('biorio', 'Bio Rio', 'Stormen'),
  uppsättning('zita', 'Zita Folkets Bio', 'Stormen'),
  uppsättning('biorio', 'Bio Rio', 'Fjord'),
  uppsättning('cinemateket', 'Cinemateket', 'Girl 6'),
  // Samma titel på en teater: får aldrig ta en filmrecension.
  { production_key: 'dramaten|stormen', venue_slug: 'dramaten', venue: 'Dramaten', title: 'Stormen', category: 'teater' },
];

const STORMEN = {
  url: `${NB}/JOjp9X/stormen-recension-bornebuschs-nya-film-ar-underhallande-men-oslipad`,
  published: '2026-10-02T06:00:00Z',
  title: 'Underhållande men oslipad',
};

test('en filmrecension utan biograf i adressen hittar filmen', () => {
  const träff = matchFilmReview(STORMEN, REPERTOAR);
  assert.equal(träff.production_key, 'film|stormen');
  assert.equal(träff.category, 'film');
  assert.equal(träff.confidence, 'osäker');
  // Husregeln ensam hittade den inte - det var hela problemet.
  assert.equal(matchReview(STORMEN, REPERTOAR), null);
});

test('"här är recensionen" räknas, titeln direkt efter ordet också', () => {
  const r = { url: `${NB}/Wv9e2r/recension-fjord-mungius-guldpalmsvinnare`, published: '2026-10-01T06:00:00Z' };
  assert.equal(matchFilmReview(r, REPERTOAR).production_key, 'film|fjord');
  const r2 = { url: `${NB}/Wv9e2r/fjord-har-ar-recensionen`, published: '2026-10-01T06:00:00Z' };
  assert.equal(matchFilmReview(r2, REPERTOAR).production_key, 'film|fjord');
});

test('utan filmsektion i adressen blir det ingen filmträff', () => {
  const teater = { ...STORMEN, url: 'https://www.aftonbladet.se/kultur/teater/a/X/stormen-recension-shakespeare' };
  assert.equal(matchFilmReview(teater, REPERTOAR), null);
});

test('titeln mitt i slugen räcker inte', () => {
  const r = { url: `${NB}/X/recension-en-film-om-en-fjord-i-norr`, published: '2026-10-01T06:00:00Z' };
  assert.equal(matchFilmReview(r, REPERTOAR), null);
});

test('en artikel som inte är en recension matchas inte', () => {
  const r = { url: `${NB}/X/stormen-bornebusch-om-inspelningen`, published: '2026-10-01T06:00:00Z' };
  assert.equal(matchFilmReview(r, REPERTOAR), null);
});

test('en recension långt före visningarna gäller en annan film', () => {
  assert.equal(matchFilmReview({ ...STORMEN, published: '2026-06-01T06:00:00Z' }, REPERTOAR), null);
  assert.equal(matchFilmReview({ ...STORMEN, published: '2026-11-30T06:00:00Z' }, REPERTOAR), null);
});

test('den längre titeln vinner när den ena innehåller den andra', () => {
  const lista = [...REPERTOAR, uppsättning('zita', 'Zita Folkets Bio', 'Stormen 2')];
  const r = { url: `${NB}/X/stormen-2-recension-uppfoljaren`, published: '2026-10-01T06:00:00Z' };
  assert.equal(matchFilmReview(r, lista).production_key, 'film|stormen-2');
});

test('raden får filmens titel och kategori men inget hus', () => {
  const träff = matchFilmReview(STORMEN, REPERTOAR);
  const rad = reviewRow({ ...STORMEN, publisher: 'nojesbladet' }, träff, undefined);
  assert.equal(rad.production_key, 'film|stormen');
  assert.equal(rad.production_title, 'Stormen');
  assert.equal(rad.category, 'film');
  assert.equal(rad.venue_slug, null);
});

test('sidan hänger recensionen på varje biograf som visar filmen', () => {
  const rad = reviewRow({ ...STORMEN, publisher: 'nojesbladet' }, matchFilmReview(STORMEN, REPERTOAR), undefined);
  const r = reviewForPage({ ...rad, published_at: rad.published_at }, REPERTOAR);
  assert.equal(r.production.venue, 'Bio Rio, Zita Folkets Bio');
  assert.deepEqual(r.production.venue_slugs, ['biorio', 'zita']);

  const per = recensionerPerUppsättning([r]);
  assert.equal(per.get(REPERTOAR[0].production_key)?.length, 1);
  assert.equal(per.get(REPERTOAR[1].production_key)?.length, 1);
  assert.equal(per.get('dramaten|stormen'), undefined);

  // Husfiltret i Nytt hittar den under vilken biograf som helst.
  assert.equal(filtreraNytt({ reviews: [r] }, { venue: 'zita' }).reviews.length, 1);
  assert.equal(filtreraNytt({ reviews: [r] }, { venue: 'dramaten' }).reviews.length, 0);
});

test('en film som inte visas längre behåller sin titel', () => {
  const rad = reviewRow({ ...STORMEN, publisher: 'nojesbladet' }, matchFilmReview(STORMEN, REPERTOAR), undefined);
  const r = reviewForPage(rad, []);
  assert.equal(r.production.title, 'Stormen');
  assert.equal(r.production.venue, 'Film');
});

test('utan filmsektion räcker titeln och regissörens efternamn', () => {
  const lista = [
    uppsättning('biorio', 'Bio Rio', 'Digger', { description: 'Regi: Alejandro G. Iñárritu. Oscarbelönade filmskaparen.' }),
    uppsättning('zita', 'Zita Folkets Bio', 'Digger', { description: 'Regi: Alejandro G. Iñárritu · USA 2026' }),
  ];
  const svt = { url: 'https://www.svt.se/kultur/recension-digger-av-alejandro-gonzalez-inarritu', published: '2026-10-01T06:00:00Z' };
  assert.equal(matchFilmReview(svt, lista).production_key, 'film|digger');

  // Utan regissören är det bara en titel i en kultursektion - kan vara teater.
  const utan = { ...svt, url: 'https://www.svt.se/kultur/recension-digger-pa-gotlands-teater' };
  assert.equal(matchFilmReview(utan, lista), null);
  // Och utan regi i beskrivningen finns inget att jämföra med.
  assert.equal(matchFilmReview(svt, lista.map((p) => ({ ...p, description: null }))), null);
});

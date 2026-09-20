import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  HUSALIAS, husUtanAlias, matchReview, parseReviewUrl, slugContains, slugify,
} from '../lib/review-match.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Verkliga poster ur DN:s, SvD:s, SVT:s och Aftonbladets flöden, hämtade
// 2026-09-20. Hela poängen med att testa mot dem: påhittade slugar bekräftar
// bara att regeln matchar det jag själv tänkte på.
const RECENSIONER = JSON.parse(readFileSync(join(here, 'fixtures', 'recensioner.json'), 'utf8'));
const hämta = (nyckel) => {
  const träff = RECENSIONER.find((r) => r.url.includes(nyckel));
  assert.ok(träff, `fixturen saknar ${nyckel}`);
  return träff;
};

// Uppsättningar som de ser ut i vyn upcoming_productions.
const PARZIVAL = {
  production_key: 'dramaten|https://www.dramaten.se/repertoar/parzival/',
  title: 'Parzival',
  venue: 'Dramaten',
  venue_slug: 'dramaten',
  premiere_at: '2026-09-19T22:00:00.000Z',
  first_at: '2026-09-23T17:00:00.000Z',
  last_at: '2026-11-18T18:00:00.000Z',
};

const GENGÅNGARE_STOCKHOLM = {
  production_key: 'dramaten|https://www.dramaten.se/repertoar/gengangare/',
  title: 'Gengångare',
  venue: 'Dramaten',
  venue_slug: 'dramaten',
  premiere_at: '2026-09-18T22:00:00.000Z',
  first_at: '2026-09-22T17:00:00.000Z',
  last_at: '2026-12-01T18:00:00.000Z',
};

test('slugify ger samma form som tidningarnas slugar', () => {
  assert.equal(slugify('Gengångare'), 'gengangare');
  assert.equal(slugify('Romeo och Julia'), 'romeo-och-julia');
  assert.equal(slugify('Kulturhuset Stadsteatern'), 'kulturhuset-stadsteatern');
  assert.equal(slugify('Så älskade Gud världen'), 'sa-alskade-gud-varlden');
  assert.equal(slugify('Cirkus – Cirkör'), 'cirkus-cirkor');
  assert.equal(slugify(null), '');
});

test('adressen avgör om det är en recension, inte rubriken', () => {
  // "Vid Ibsens polisonger – sanning är något extremt" är rubriken på en
  // recension. Ingenting i den säger det.
  const r = hämta('recension-gengangare-malmo-stadsteater');
  assert.match(r.title, /Ibsens polisonger/);

  const adress = parseReviewUrl(r.url);
  assert.equal(adress.isReview, true);
  assert.equal(adress.slug, 'recension-gengangare-malmo-stadsteater');
  assert.ok(adress.segments.includes('teater'));
});

test('en trasig adress ger inget kast', () => {
  assert.equal(parseReviewUrl('inte en adress').isReview, false);
  assert.equal(parseReviewUrl(null).isReview, false);
  assert.equal(parseReviewUrl(undefined).slug, '');
});

test('ordgränser krävs, annars matchar Fejk allt', () => {
  // Våra titlar är korta och generiska: Fejk, Vilse, Glow up.
  assert.equal(slugContains('recension-fejk-pa-dramaten', 'fejk'), true);
  assert.equal(slugContains('recension-fejkade-kvitton-i-stockholm', 'fejk'), false);
  assert.equal(slugContains('recension-romeo-och-julia-pa-dramaten', 'romeo-och-julia'), true);
  assert.equal(slugContains('recension-julia-pa-dramaten', 'romeo-och-julia'), false);
});

test('Parzival på Dramaten matchar, och det är en riktig recension ur flödet', () => {
  const r = hämta('recension-parzival-av-lukas-barfuss-pa-dramaten');

  const träff = matchReview(r, [PARZIVAL]);

  assert.ok(träff, 'matchade inte');
  assert.equal(träff.production_key, PARZIVAL.production_key);
  assert.equal(träff.matched_title, 'parzival');
  assert.equal(träff.matched_venue, 'dramaten');
});

test('samma pjäs på ett annat hus matchar inte', () => {
  // Det här är kravet som gör hela regeln användbar. Gengångare spelas i
  // Malmö, och båda recensionerna i flödet handlar om den - inte om en
  // Stockholmsuppsättning med samma namn.
  for (const nyckel of [
    'recension-gengangare-malmo-stadsteater',
    'recension-gengangare-av-henrik-ibsen-pa-hipp-i-malmo',
  ]) {
    assert.equal(matchReview(hämta(nyckel), [GENGÅNGARE_STOCKHOLM]), null, nyckel);
  }
});

test('ingen av de tjugoen verkliga recensionerna matchar fel', () => {
  // Flödena är fulla av Malmö, Göteborg, Uppsala, Norrköping, Köpenhamn,
  // böcker och film. Av tjugoen poster ska exakt en matcha våra två
  // uppsättningar, och det är Parzival.
  const uppsättningar = [PARZIVAL, GENGÅNGARE_STOCKHOLM];
  const träffar = RECENSIONER
    .map((r) => ({ url: r.url, träff: matchReview(r, uppsättningar) }))
    .filter((x) => x.träff);

  assert.equal(träffar.length, 1, `matchade ${träffar.length}: ${träffar.map((t) => t.url).join(', ')}`);
  assert.match(träffar[0].url, /parzival/);
});

test('bokrecensioner utesluts på sektionen', () => {
  const bok = hämta('kapitalet-av-therese-bohman-recension');

  // Även om en uppsättning skulle heta Kapitalet och spelas på Dramaten.
  const påhittad = { ...PARZIVAL, title: 'Kapitalet', production_key: 'dramaten|kapitalet' };
  assert.equal(matchReview(bok, [påhittad]), null);
});

test('en recension långt efter premiären hör till en annan uppsättning', () => {
  // Samma pjäs sätts upp igen om några år. Titel och hus stämmer då fortfarande.
  const gammal = { ...hämta('recension-parzival-av-lukas-barfuss-pa-dramaten'), published: 'Mon, 12 Mar 2029 09:00:00 GMT' };
  assert.equal(matchReview(gammal, [PARZIVAL]), null);
});

test('utan premiärdatum duger att recensionen kom medan pjäsen spelades', () => {
  // Konserthuset och Operan ger inga premiärdatum. Gränsen blir svagare men
  // rimlig: en recension publicerad efter derniären hör inte hit.
  const utan = { ...PARZIVAL, premiere_at: null };
  const r = hämta('recension-parzival-av-lukas-barfuss-pa-dramaten');

  const träff = matchReview(r, [utan]);
  assert.ok(träff);
  assert.equal(träff.confidence, 'osäker', 'utan premiär ska matchningen inte kallas säker');

  const efteråt = { ...r, published: 'Mon, 01 Jan 2029 09:00:00 GMT' };
  assert.equal(matchReview(efteråt, [utan]), null);
});

test('två lika bra kandidater ger ingen match', () => {
  // Två uppsättningar med samma titel på samma hus kan regeln inte skilja åt.
  // Att välja den ena vore en gissning som ser ut som ett svar.
  const a = { ...PARZIVAL, production_key: 'dramaten|a' };
  const b = { ...PARZIVAL, production_key: 'dramaten|b' };

  assert.equal(matchReview(hämta('recension-parzival'), [a, b]), null);
});

test('en artikel som inte är en recension matchas aldrig', () => {
  const nyhet = { url: 'https://www.dn.se/kultur/dramaten-far-ny-chef/', published: 'Sun, 20 Sep 2026 09:00:00 GMT' };
  assert.equal(matchReview(nyhet, [PARZIVAL]), null);
});

test('varje registrerat hus har alias', () => {
  // Ett hus utan alias kan aldrig matcha någonting, och felet är tyst: inga
  // recensioner dyker upp och ingenting säger varför.
  assert.deepEqual(husUtanAlias(), []);
  for (const alias of Object.values(HUSALIAS)) {
    assert.ok(alias.length > 0);
    for (const a of alias) assert.equal(a, slugify(a), `${a} är inte en slug`);
  }
});

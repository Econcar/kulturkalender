// Botkyrka konsthall, Thielska, Färgfabriken och Konsthall C, 2026-11-21.
// Utdragen är avskrivna ur riktiga sidor och bantade.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDateRange } from '../lib/event.mjs';
import { ingress, utställningsrad } from '../scanner/lib/utstallning.mjs';
import { färgfabrikenKort, konsthallC, konsthallCRad, spannUtanÅr } from '../scanner/sources/konsthallar.mjs';

const dag = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
const NU = new Date('2026-11-21T10:00:00Z');

// --- Datum ------------------------------------------------------------------

test('spann inom en månad: "24–28 november 2026"', () => {
  const s = parseDateRange('STYRKA En utställning av elever 24–28 november 2026 Plats: Entrén');
  assert.equal(dag(s.starts_at), '2026-11-24 00:00:00');
  assert.equal(dag(s.ends_at), '2026-11-28 23:59:00');
  // Klockslag är inga dagar.
  assert.equal(parseDateRange('Vernissage torsdag 3 september, kl 17.30–19.00'), null);
  assert.equal(parseDateRange('Öppet kl 12–17 november 2026'), null);
});

test('den hela formen går före formen inom en månad', () => {
  const s = parseDateRange('Visning 24–28 november 2026. Utställningen 21 november 2026–6 mars 2027');
  assert.equal(dag(s.ends_at), '2027-03-06 23:59:00');
});

test('Färgfabriken: året räknas ut från i dag', () => {
  const pågår = spannUtanÅr(29, 8, 22, 11, NU);
  assert.equal(dag(pågår.starts_at), '2026-08-29 00:00:00');
  assert.equal(dag(pågår.ends_at), '2026-11-22 23:59:00');
  // Slutet i maj ligger nästa år.
  assert.equal(dag(spannUtanÅr(13, 2, 22, 5, NU).ends_at), '2027-05-22 23:59:00');
  // Över nyår: starten året innan slutet.
  const vinter = spannUtanÅr(5, 12, 8, 3, NU);
  assert.equal(dag(vinter.starts_at), '2026-12-05 00:00:00');
  assert.equal(dag(vinter.ends_at), '2027-03-08 23:59:00');
  // Det som stängde i förrgår ligger kvar i år - och sorteras bort som slutat.
  assert.equal(dag(spannUtanÅr(1, 9, 19, 11, NU).ends_at), '2026-11-19 23:59:00');
});

// --- Sidorna ----------------------------------------------------------------

test('ingressen: raden med datumspannet är ingen ingress', () => {
  const html = '<p>SVEN XET ERIXSON, LIV – DÖD – LIV<br>21 november 2026–6 mars 2027<br>Botkyrka konsthall</p>'
    + '<p>En konstnärlig resa genom vardagens mirakel, dödens närvaro och livets envisa återkomst.</p>';
  assert.match(ingress(html), /^En konstnärlig resa/);
});

test('ingressen: Thielskas platshållare är ingen ingress', () => {
  const html = '<meta property="og:description" content="Mer information kommer inom kort." />'
    + '<h1>Öland, mellan himmel och hav</h1><p>12 februari–22 augusti 2027</p>';
  assert.equal(ingress(html), null);
  // En riktig ingress som råkar börja likt står kvar.
  const riktig = '<meta property="og:description" content="Informationen om Öland samlades av konstnärerna under ett halvsekel." />';
  assert.match(ingress(riktig), /^Informationen om Öland/);
});

test('Botkyrka: sidan till en rad', () => {
  const html = '<meta property="og:title" content="LIV - DÖD - LIV - Botkyrka konsthall" />'
    + '<meta property="og:image" content="https://www.botkyrkakonsthall.se/media/2026/10/LDL.png" />'
    + '<h1>LIV - DÖD - LIV</h1><p>VERNISSAGE 21 november 2026 kl 14–17</p>'
    + '<p>SVEN XET ERIXSON, LIV – DÖD – LIV<br>21 november 2026–6 mars 2027<br>Botkyrka konsthall</p>'
    + '<p>En konstnärlig resa genom vardagens mirakel, dödens närvaro och livets envisa återkomst.</p>';
  const rad = utställningsrad(html, 'https://www.botkyrkakonsthall.se/evenemang/liv-dod-liv/', {
    organizer: 'Botkyrka konsthall', titelSuffix: /\s*[-–|]\s*Botkyrka konsthall$/,
  });
  assert.equal(rad.title, 'LIV - DÖD - LIV');
  assert.equal(dag(rad.starts_at), '2026-11-21 00:00:00');
  assert.equal(dag(rad.ends_at), '2027-03-06 23:59:00');
  assert.match(rad.description, /^En konstnärlig resa/);
});

// --- Färgfabriken -----------------------------------------------------------

const FÄRG = `<div class="projekt-post">
<a href="https://fargfabriken.se/sv/pa-gang/ndidi-dike/"><div class="projekt-image"><img data-lazyloaded="1" src="data:image/svg+xml;base64," data-src="https://fargfabriken.se/wp-content/uploads/2025/12/ndidi-1024x683.jpg" class="x" /></div>
</a><div>
<span class="small-text projekt-category">utställning</span></div>
<a href="https://fargfabriken.se/sv/pa-gang/ndidi-dike/"><h3 class="projekt-title pa-gang">Ndidi Dike</h3>
</a><h4 class="projekt-subtitle pa-gang">– Rare Earth Rare Justice</h4><h4><div class="date-period">	<span class="start-date">29 augusti</span>
<span class='end-date'>22 november</span></div></h4></div><div class="projekt-post">
<a href="https://fargfabriken.se/sv/pa-gang/julmarknad-3/"><div class="projekt-image"><img data-src="https://fargfabriken.se/wp-content/uploads/2026/11/jul.png" /></div></a><div>
<span class="small-text projekt-category">aktivitet</span></div>
<a href="https://fargfabriken.se/sv/pa-gang/julmarknad-3/"><h3 class="projekt-title pa-gang">Julmarknad</h3></a>
<h4><div class="date-period"><span class="start-date">5 december</span><span class='end-date'>6 december</span></div></h4></div>`;

test('Färgfabriken: bara utställningarna, titeln med undertitel', () => {
  const kort = färgfabrikenKort(FÄRG, 'https://fargfabriken.se/sv/pa-gang/', NU);
  assert.equal(kort.length, 1);
  assert.equal(kort[0].title, 'Ndidi Dike – Rare Earth Rare Justice');
  assert.equal(kort[0].url, 'https://fargfabriken.se/sv/pa-gang/ndidi-dike/');
  assert.equal(kort[0].image_url, 'https://fargfabriken.se/wp-content/uploads/2025/12/ndidi-1024x683.jpg');
  assert.equal(dag(kort[0].spann.ends_at), '2026-11-22 23:59:00');
});

// --- Konsthall C ------------------------------------------------------------

const text = (t, type = 'paragraph') => (t ? [{ type, text: t, spans: [] }] : []);
const dok = (uid, kategori, start, slut, { titel = uid, konstnär = '', ingressText = '', body = [] } = {}) => ({
  uid,
  data: {
    title: text(titel, 'heading1'),
    artist: text(konstnär, 'heading1'),
    ingress: text(ingressText),
    start_time: start,
    end_time: slut,
    category: { slug: kategori },
    featured_image: { url: `https://images.prismic.io/konsthallcse/${uid}.jpg?auto=format,compress` },
    body,
  },
});

test('Konsthall C: ett dokument till en rad', () => {
  const rad = konsthallCRad(dok('kif-2026', 'utstallning', '2026-11-21T15:17:00+0000', '2026-12-06T15:17:00+0000', {
    titel: 'Vem stal den vackra trädgården från gåsen?',
    konstnär: 'Konst i förskolan 2026',
    ingressText: 'I årets version av vårt samarbete med Farstas kommunala förskolor blir barnen trädgårdsmästare.',
  }));
  assert.equal(rad.title, 'Vem stal den vackra trädgården från gåsen? – Konst i förskolan 2026');
  assert.equal(rad.url, 'https://www.konsthallc.se/program/kif-2026');
  assert.equal(rad.starts_at, '2026-11-21T15:17:00.000Z');
  assert.equal(rad.organizer, 'Konsthall C');
  assert.match(rad.description, /^I årets version/);
  assert.match(rad.image_url, /kif-2026\.jpg/);
});

test('Konsthall C: utan ingress tas första stycket som inte är vernissagen', () => {
  const body = [{ slice_type: 'text', primary: { rich_text: [
    ...text('Vernissage torsdag 16 maj kl 16.00–18.00. Öppningstal kl 17.45, dryck och tilltugg på plats i centrum.'),
    ...text('Konsthall C är glada att presentera en ny utställning med fotografier tagna i landskap, vid sjöar och på vidder.'),
  ] } }];
  const rad = konsthallCRad(dok('homeplace', 'utstallning', '2026-12-01T10:00:00+0000', '2027-01-10T16:00:00+0000', { body }));
  assert.match(rad.description, /^Konsthall C är glada/);
});

test('Konsthall C: projekt, nyheter och dokument utan slut är inga utställningar', () => {
  assert.equal(konsthallCRad(dok('scales', 'projekt', '2026-05-01T15:00:00+0000', '2027-01-20T16:00:00+0000')), null);
  assert.equal(konsthallCRad(dok('stangt', 'nyheter', '2026-11-15T07:56:00+0000', null)), null);
});

test('Konsthall C: hela kedjan, med den aktuella versionen av innehållet', async () => {
  const frågor = [];
  const källa = konsthallC();
  const rader = await källa.fetchEvents({
    log: () => {}, paus: async () => {}, robotsOk: async () => true, now: NU,
    hämta: async (url) => {
      frågor.push(url);
      if (url.endsWith('/api/v2')) return JSON.stringify({ refs: [{ ref: 'REF1', isMasterRef: true }] });
      return JSON.stringify({ results: [
        dok('kif-2026', 'utstallning', '2026-11-21T15:17:00+0000', '2026-12-06T15:17:00+0000'),
        dok('scales', 'projekt', '2026-05-01T15:00:00+0000', '2027-01-20T16:00:00+0000'),
      ] });
    },
  });
  assert.deepEqual(rader.map((r) => r.title), ['kif-2026']);
  const sök = new URL(frågor[1]);
  assert.equal(sök.searchParams.get('ref'), 'REF1');
  assert.match(sök.searchParams.get('q'), /date\.after\(my\.activity\.end_time,"2026-11-21"\)/);
});

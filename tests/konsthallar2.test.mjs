// Fler konsthallar, 2026-11-21. Utdragen är avskrivna ur riktiga sidor och bantade.

import test from 'node:test';
import assert from 'node:assert/strict';

import { spannFrånDelar } from '../lib/event.mjs';
import { ingress, utställningsrad } from '../scanner/lib/utstallning.mjs';
import {
  acceleratorKort, arkdesSpann, listkonsthall, marabouKort, millesKort, tenstaSpann,
} from '../scanner/sources/konsthallar.mjs';

const dag = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

// --- Datum ------------------------------------------------------------------

test('ArkDes: "Startar 2026.10.23 - Slutar 2027.09.26"', () => {
  const s = arkdesSpann('Utställningar Startar 2026.10.23 - Slutar 2027.09.26 Sal 2');
  assert.equal(dag(s.starts_at), '2026-10-23 00:00:00');
  assert.equal(dag(s.ends_at), '2027-09-26 23:59:00');
});

test('Tensta: "11.9 2026—10.1 2027", och startåret får saknas', () => {
  const s = tenstaSpann('Ernest Mancoba 11.9 2026—10.1 2027 Remnants formar');
  assert.equal(dag(s.starts_at), '2026-09-11 00:00:00');
  assert.equal(dag(s.ends_at), '2027-01-10 23:59:00');
  assert.equal(dag(tenstaSpann('11.9—10.1 2027').starts_at), '2026-09-11 00:00:00');
  // Ett ensamt datum - en skolvisning, ett samtal - är inget spann.
  assert.equal(tenstaSpann('Samtal 12.12 2026 kl 14'), null);
});

test('ogiltiga datum rullar inte vidare', () => {
  assert.equal(spannFrånDelar(31, 6, 2026, 1, 8, 2026), null);
  assert.equal(spannFrånDelar(1, 13, 2026, 1, 8, 2027), null);
});

// --- Sidorna ----------------------------------------------------------------

test('ArkDes: sidan till en rad, utan husets namn i titeln', () => {
  const html = '<meta property="og:title" content="ArkDes samling: Utan gränser - ArkDes" />'
    + '<meta property="og:image" content="https://arkdes.se/a.jpg" />'
    + '<p>Startar 2026.10.23 - Slutar 2027.09.26</p>'
    + '<p>ArkDes har en av världens största samlingar av arkitektur och design, och här visas den i en ny form.</p>';
  const rad = utställningsrad(html, 'https://arkdes.se/utstallningar/x/', { organizer: 'ArkDes', titelSuffix: /\s*[-–|]\s*ArkDes$/, spann: arkdesSpann });
  assert.equal(rad.title, 'ArkDes samling: Utan gränser');
  assert.match(rad.description, /^ArkDes har en av världens/);
  assert.equal(rad.category, 'utställning');
});

test('ingressen: sajtens allmänna text räknas inte, nyhetsbrevet inte heller', () => {
  const allmän = 'Tensta konsthall är en plats för samtida konst i Tensta i nordvästra Stockholm.';
  const html = `<meta name="description" content="${allmän}">`
    + '<p>Prenumerera på vårt nyhetsbrev och få tips om utställningar, event och spännande samtal varje månad.</p>'
    + '<div class="description"> <em>Remnants</em> formar en poetisk konstellation av uttryck från nu levande konstnärer och konstnärer som inte längre är i livet. <br> <a class="out las" href="#d">Läs mer</a></div>';
  assert.match(ingress(html, new Set([allmän])), /^Remnants formar/);
  // Utan kännedom om den allmänna texten vinner den - den är sidans egen.
  assert.equal(ingress(html), allmän);
});

test('ingressen: <path> och <picture> är inga stycken', () => {
  const html = '<svg><path d="M622.955,342.127L268.424,20.521c-27.36-27.36-71.677-27.36-99.037,0c-27.36,27.36-27.36,71.676,0,99.037"></path></svg>'
    + '<p>Iconic Collaborations på Sven-Harrys Konstmuseum är en storslagen utställning om mode och konst.</p>';
  assert.match(ingress(html), /^Iconic Collaborations/);
});

// --- Listorna ---------------------------------------------------------------

test('Accelerator: kortet bär titel, bild och datum', () => {
  const html = `<a href="https://acceleratorsu.art/utstallning/aerpiemaahtoe/" class="exhibition-list-teaser__wrapper "> <span class="exhibition-list-teaser__wrapper__status">Aktuell utställning</span>
    <div class="exhibition-list-teaser__wrapper__image"> <img class="x" src="https://acceleratorsu.art/wp-content/uploads/2026/06/a.jpg" alt="" /> </div>
    <div class="exhibition-list-teaser__wrapper__content"> <span class="exhibition-list-teaser__wrapper__content__date text">12 sep - 14 feb 2027</span>
    <h3> <span class="arrow-link" > <span class="arrow-link__label">Aerpiemaahtoe</span> </span></h3></div></a>`;
  const [k] = acceleratorKort(html, 'https://acceleratorsu.art/utstallning/');
  assert.equal(k.title, 'Aerpiemaahtoe');
  assert.equal(k.image_url, 'https://acceleratorsu.art/wp-content/uploads/2026/06/a.jpg');
  assert.equal(dag(k.spann.starts_at), '2026-09-12 00:00:00');
  assert.equal(dag(k.spann.ends_at), '2027-02-14 23:59:00');
});

test('Marabouparken: bildspelets bilder är utställningarna', () => {
  const html = `<li style=""> <a href="https://marabouparken.se/berattelser-utan-borjan/"> <img src="https://marabouparken.se/wp-content/uploads/2026/10/eva.jpg" alt="Foto" />
    <div class="caption"><h1> Éva Mag – berättelser utan början <span class="pe" > 24 oktober 2026&ndash;7 mars 2027</span> </h1> </div></a> </li>`;
  const [k] = marabouKort(html, 'https://marabouparken.se/utstallningar/');
  assert.equal(k.title, 'Éva Mag – berättelser utan början');
  assert.equal(k.url, 'https://marabouparken.se/berattelser-utan-borjan/');
  assert.equal(dag(k.spann.ends_at), '2027-03-07 23:59:00');
});

const MILLES_MENY = `<a href="/utstallningar/aktuella-utstallningar-pa-millesgarden/liv-i-farg-form-robert-och-barbro-nilsson-1" target="_top">Liv i färg & form - Robert och Barbro Nilsson</a>
  <a href="/utstallningar/kommande-utstallningar/torun-tidlos-i-silver" target="_top">TORUN - Tidlös i silver</a>`;

test('Millesgården: datumet i rubriken, namnet ur menyn och inte i versaler', () => {
  const html = `${MILLES_MENY}<img data-src='/files/modules/HtmlArticle/images/processedimages/1.jpeg?v=1' alt=''>
    <div class="article-dynamic-template-header"><h2> <p>LIV I FÄRG &amp; FORM</p><p> Robert och Barbro Nilsson</p><p> 12 september 2026 - 29 mars 2027<br></p> </h2></div>
    <div class="article-dynamic-template-content"> <p><strong>Robert Nilsson, skulptör, och Barbro Nilsson, textilkonstnär</strong> och konstnärlig ledare för AB Märta Måås-Fjetterström.</p></div>
    <div class="article-dynamic-template-header"><h2> "Lustfylld ögonfägnad av makarna Nilsson på Millesgården" </h2></div>
    <footer><div class="article-dynamic-template-header"><h2> Följ oss </h2></div></footer>`;
  const kort = millesKort(html, 'https://www.millesgarden.se/utstallningar/aktuella-utstallningar-pa-millesgarden');
  assert.equal(kort.length, 1);
  assert.equal(kort[0].title, 'Liv i färg & form - Robert och Barbro Nilsson');
  assert.equal(kort[0].image_url, 'https://www.millesgarden.se/files/modules/HtmlArticle/images/processedimages/1.jpeg?v=1');
  assert.match(kort[0].description, /^Robert Nilsson, skulptör/);
  assert.equal(dag(kort[0].spann.starts_at), '2026-09-12 00:00:00');
});

test('Millesgården: den kommande har datumet sist i texten', () => {
  const html = `${MILLES_MENY}
    <div class="article-dynamic-template-header"><h2> TORUN<br>Tidlös i silver<br> </h2></div>
    <div class="article-dynamic-template-content"><p>Våren 2027 presenterar Millesgården en utställning om Vivianna Torun Bülow-Hübe och hennes formgivning i silver.<br><br><em>17 april - 19 september 2027.&nbsp;</em></p></div>
    <footer>Millesgården Museum 1 januari - 31 december 2027</footer>`;
  const [k] = millesKort(html, 'https://www.millesgarden.se/utstallningar/kommande-utstallningar');
  assert.equal(k.title, 'TORUN - Tidlös i silver');
  assert.equal(k.url, 'https://www.millesgarden.se/utstallningar/kommande-utstallningar/torun-tidlos-i-silver');
  assert.equal(dag(k.spann.starts_at), '2027-04-17 00:00:00');
  assert.equal(dag(k.spann.ends_at), '2027-09-19 23:59:00');
});

// --- Hela kedjan ------------------------------------------------------------

test('listkonsthall: det som slutat sorteras bort, ingressen hämtas när listan saknar den', async () => {
  const källa = listkonsthall({
    id: 'x',
    label: 'X',
    listor: ['https://x.se/lista'],
    kort: () => [
      { url: 'https://x.se/ny', title: 'Ny', spann: { starts_at: '2026-11-01T00:00:00Z', ends_at: '2027-01-01T00:00:00Z' } },
      { url: 'https://x.se/gammal', title: 'Gammal', spann: { starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-03-01T00:00:00Z' } },
    ],
  });
  const sidor = {
    'https://x.se/lista': '<meta name="description" content="Allmänt om X.">',
    'https://x.se/ny': '<meta name="description" content="Allmänt om X."><p>Den nya utställningen handlar om ljus, skugga och allt däremellan i ett stort rum.</p>',
  };
  const rader = await källa.fetchEvents({
    log: () => {}, paus: async () => {}, robotsOk: async () => true,
    hämta: async (u) => sidor[u], now: new Date('2026-11-21T10:00:00Z'),
  });
  assert.deepEqual(rader.map((r) => r.title), ['Ny']);
  assert.match(rader[0].description, /^Den nya utställningen/);
  assert.equal(rader[0].organizer, 'X');
});

// Musikscenerna, 2026-09-27. Utdragen är avskrivna ur riktiga sidor och
// bantade till det adaptrarna läser.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runScan } from '../scanner/run.mjs';
import { cards, detail, toRow as nalenRad } from '../scanner/sources/nalen.mjs';
import { eventUrls as slUrls } from '../scanner/sources/stockholmlive.mjs';
import { concertUrls, eventsFromPage as bwRader } from '../scanner/sources/berwaldhallen.mjs';
import { post, toRow as faschingRad } from '../scanner/sources/fasching.mjs';
import { infobox, toRow as debaserRad, välj } from '../scanner/sources/debaser.mjs';

const stockholm = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
const nextData = (pageProps) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script>`;

// --- Nalen ------------------------------------------------------------------

const NALEN_START = nextData({
  blocks: [{
    artistCarousel: [{
      artists: [{
        component: 'artistCard',
        startDate: '2027-03-03 19:00',
        endDate: '',
        price: '295 SEK',
        image: { filename: 'https://a.storyblok.com/f/1/bild.jpg' },
        artistName: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Madison Mcferrin' }] }] },
        artistPageUrl: { cached_url: 'konsert/madison-mcferrin' },
      }],
    }],
  }],
});

const NALEN_SIDA = nextData({
  story: {
    content: {
      body: [{
        component: 'artistCardBig', startDate: '2027-03-03 19:00', entry: '19.00', eventStart: '20.00',
        venue: 'Stora Salen', genre: '–', price: '295 SEK',
        ticketButtonUrl: { url: 'https://secure.tickster.com/vnk7mbdfrb1w9z2' },
      }],
    },
  },
});

test('Nalen: kortets tid är dörrtiden, sidans scentid vinner', () => {
  const [kort] = cards(NALEN_START);
  assert.equal(stockholm(kort.starts_at), '2027-03-03 19:00:00');
  const rad = nalenRad(kort, detail(NALEN_SIDA));
  assert.equal(stockholm(rad.starts_at), '2027-03-03 20:00:00');
  assert.equal(rad.venue_raw, 'Stora Salen');
  assert.equal(rad.price_min, 295);
  assert.equal(rad.genre, null, 'ett streck som genre ska inte bli en genre');
  assert.equal(rad.external_id, 'konsert/madison-mcferrin');
});

test('Nalen: utan konsertsidan används kortets tid', () => {
  const [kort] = cards(NALEN_START);
  assert.equal(stockholm(nalenRad(kort, null).starts_at), '2027-03-03 19:00:00');
});

// --- Stockholm Live ---------------------------------------------------------

test('Stockholm Live: sport och undersidor räknas bort, arenan syns i värden', () => {
  const html = [
    'href="https://aviciiarena.se/evenemang/musik-show/deep-purple/"',
    'href="https://aviciiarena.se/evenemang/musik-show/deep-purple/premiumexperience/"',
    'href="https://aviciiarena.se/evenemang/sport/djurgarden-hockey/"',
    'href="https://annexet.se/evenemang/musik-show/placebo/"',
    'href="https://sodrateatern.com/evenemang/musik-show/the-proclaimers/"',
  ].join(' ');
  const urls = slUrls(html);
  assert.ok(urls.includes('https://aviciiarena.se/evenemang/musik-show/deep-purple/'));
  assert.ok(!urls.some((u) => u.includes('/sport/')));
  assert.ok(!urls.some((u) => u.includes('premiumexperience')));
  assert.equal(urls.filter((u) => new URL(u).hostname === 'annexet.se').length, 1);
});

// --- Berwaldhallen ----------------------------------------------------------

const BW = `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'EventSeries',
  name: 'Balett i brytningstid',
  image: 'https://cdn-production.berwaldhallen.se/bild.jpg',
  offers: { '@type': 'Offer', price: '175', priceCurrency: 'SEK' },
  subEvent: [
    {
      '@type': 'Event', '@id': 'https://berwaldhallen.se/event/120606', name: 'Balett i brytningstid',
      startDate: '2026-10-22T18:00:00+02:00', endDate: '2026-10-22T19:00:00+02:00',
      location: { '@type': 'Place', name: 'Berwaldhallen' },
    },
    {
      '@type': 'Event', '@id': 'https://berwaldhallen.se/event/120607', name: 'Balett i brytningstid',
      startDate: '2026-10-24T15:00:00+02:00', location: { '@type': 'Place', name: 'Uppsala Konsert & Kongress' },
    },
  ],
})}</script>`;

test('Berwaldhallen: en rad per föreställning, inte de på andra scener', () => {
  const rader = bwRader(BW, 'https://www.berwaldhallen.se/konsert/balett-i-brytningstid');
  assert.equal(rader.length, 1);
  assert.equal(stockholm(rader[0].starts_at), '2026-10-22 18:00:00');
  assert.equal(rader[0].external_id, '120606');
  assert.equal(rader[0].category, 'konsert');
  assert.equal(rader[0].price_min, 175);
});

test('Berwaldhallen: konsertadresserna ur kalenderns inbäddade data', () => {
  const html = '\\"href\\":\\"/konsert/bowie-in-berlin\\" konsert/bowie-in-berlin konsert/akademiska-koren-fyller-95-ar';
  assert.deepEqual(concertUrls(html), [
    'https://www.berwaldhallen.se/konsert/bowie-in-berlin',
    'https://www.berwaldhallen.se/konsert/akademiska-koren-fyller-95-ar',
  ]);
});

// --- Fasching ---------------------------------------------------------------

const FASCHING = `<html><head><meta name="description" content="Londonsaxofonist.">
<meta property="og:image" content="https://www.fasching.se/bild.jpg"></head><body>
<nav>Barnkonserter Nattklubbar</nav><div>Cookie-inställningar Inställningar</div>
<h1>Laura Misch</h1> Läs mer Laura Misch är londonsaxofonist.
Datum söndag 27 september 2026 Tider På scen: 20:00 Dörrarna öppnar: 18:00
Scen Stora scen Pris Student: 180 KR Stående: 280 KR Matplats: 330 KR +serviceavgift Övrigt Åldersgräns 18</body></html>`;

test('Fasching: bara svenska inlägg med datum i adressen', () => {
  assert.deepEqual(post({ link: 'https://www.fasching.se/laura-misch-2026-09-27/', title: { rendered: 'Laura Misch' } }),
    { url: 'https://www.fasching.se/laura-misch-2026-09-27/', title: 'Laura Misch', datum: '2026-09-27' });
  assert.equal(post({ link: 'https://www.fasching.se/en/laura-misch-2026-09-27/', title: { rendered: 'x' } }), null);
  assert.equal(post({ link: 'https://www.fasching.se/om-fasching/', title: { rendered: 'x' } }), null);
});

test('Fasching: scentiden, scenen och priserna ur texten', () => {
  const rad = faschingRad({ url: 'https://www.fasching.se/laura-misch-2026-09-27/', title: 'Laura Misch', datum: '2026-09-27' }, FASCHING);
  assert.equal(stockholm(rad.starts_at), '2026-09-27 20:00:00');
  assert.equal(rad.venue_raw, 'Stora scen');
  assert.equal(rad.price_min, 180);
  assert.equal(rad.price_max, 330);
});

test('Fasching: menyns "Barnkonserter" och cookierutans "Inställningar" räknas inte', () => {
  // I hela sidans text blev varenda konsert en inställd barnkonsert.
  const rad = faschingRad({ url: 'https://www.fasching.se/laura-misch-2026-09-27/', title: 'Laura Misch', datum: '2026-09-27' }, FASCHING);
  assert.equal(rad.category, 'konsert');
  assert.equal(rad.status, 'scheduled');
});

// --- Debaser ----------------------------------------------------------------

const DEBASER = `<h1>Dirty Three</h1><dl>
<div><dt class="event-infobox__etikett">Datum</dt><dd class="event-infobox__varde"> Lör 31 Okt 2026 </dd></div>
<div><dt class="event-infobox__etikett">Tider</dt><dd class="event-infobox__varde"> Dörrar 19.00 </dd></div>
<div><dt class="event-infobox__etikett">Scen</dt><dd class="event-infobox__varde notranslate"> Debaser Strand </dd></div>
<div><dt class="event-infobox__etikett">Pris</dt><dd class="event-infobox__varde"> 375 kr + serviceavgift </dd></div>
</dl><a href="https://secure.tickster.com/abc">Köp</a>`;

test('Debaser: faktarutan till en rad', () => {
  assert.equal(infobox(DEBASER).scen, 'Debaser Strand');
  const rad = debaserRad(DEBASER, 'https://www.debaser.se/events/dirty-three');
  assert.equal(stockholm(rad.starts_at), '2026-10-31 19:00:00');
  assert.equal(rad.price_min, 375);
  assert.equal(rad.venue_raw, 'Debaser Strand');
  assert.equal(rad.external_id, 'dirty-three');
});

test('Debaser: huvudaktens tid när den står, annars scentid, annars dörrar', () => {
  assert.equal(välj('Dörrar 19.00 Lamia Vox 19.45 King Dude 20.45', 'KING DUDE'), '20:45');
  assert.equal(välj('Dörrar 18.30 Scen 19.30', 'Någon'), '19:30');
  assert.equal(välj('Dörrar 19.00', 'Grave'), '19:00');
  assert.equal(välj('', 'Grave'), null);
});

// --- Små arenor -------------------------------------------------------------

test('en källa som kan vara tom larmar inte på noll', async (t) => {
  t.after(() => { process.exitCode = 0; });
  process.exitCode = 0;
  const db = { dryRun: true, startRun: async () => async () => {}, upsertEvents: async (r) => r.length };
  const resultat = await runScan({
    client: db,
    sources: [{ id: 'hovet', label: 'Hovet', kanVaraTom: true, fetchEvents: async () => [] }],
  });
  assert.equal(resultat.sources[0].status, 'ok');
  assert.equal(process.exitCode, 0);
});

// --- Dansens Hus ------------------------------------------------------------

test('Dansens Hus: en rad per kväll, passerade kvällar bort', async () => {
  const { toRows } = await import('../scanner/sources/dansenshus.mjs');
  const post = {
    id: 42, link: 'https://dansenshus.se/program/hofesh-shechter-gbr-theatre-of-dreams/',
    title: { rendered: 'Hofesh Shechter [GBR] | Theatre of Dreams' },
    meta_box: {
      show_group: [{ show_datetime: '2026-09-01 19:00' }, { show_datetime: '2026-11-17 19:00' }, { show_datetime: '2026-11-18 19:00' }],
      event_duration: '70', event_tickets_url: 'https://www.ticketmaster.se/x',
    },
  };
  const rader = toRows(post, new Date('2026-09-27T10:00:00Z'), 'https://dansenshus.se/bild.jpg');
  assert.equal(rader.length, 2);
  assert.equal(stockholm(rader[0].starts_at), '2026-11-17 19:00:00');
  assert.equal(stockholm(rader[0].ends_at), '2026-11-17 20:10:00');
  assert.equal(rader[0].category, 'dans');
  assert.equal(rader[0].image_url, 'https://dansenshus.se/bild.jpg');
  assert.notEqual(rader[0].external_id, rader[1].external_id);
});

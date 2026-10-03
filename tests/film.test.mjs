// Biograferna, 2026-10-03. Utdragen är avskrivna ur riktiga svar och bantade.

import test from 'node:test';
import assert from 'node:assert/strict';

import { toRows as zitaRader } from '../scanner/sources/zita.mjs';
import { filmUrls, screeningsFromPage } from '../scanner/sources/biorio.mjs';

const stockholm = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

// --- Zita -------------------------------------------------------------------

const ZITA = {
  week_events: {
    '2026-10-04': [{
      title: 'Skattkartan & Skattsökarfärden', media_id: 6009, kinoplex_url: 'skattkartan-amp--skattsokarfarden',
      genre: 'Animerad film', runtime: '35', language: 'Svenska', subtitles: 'Ingen textning',
      directors: 'Rune Andréasson', kinoplex_country: 'Sverige', kinoplex_year: '1972',
      event: 'Zita Barnens Bio', images: ['https://zita.se/uploads/images/media/6009/skattkamaren.jpg'],
      showings: [{ screen_name: '3', ctime: '12:00:00', booking_url: 'https://bio.se/biografer/zita-folkets-bio/20261004/1200/Salong%203' }],
    }, {
      title: 'De Gaulle: Motståndets Pris', media_id: 5935, kinoplex_url: 'motstandets-pris',
      genre: 'Drama', runtime: '160', language: 'Franska', event: '',
      showings: [
        { screen_name: '1', ctime: '18:00:00', booking_url: 'https://bio.se/a' },
        { screen_name: '2', ctime: '20:30:00', booking_url: 'https://bio.se/b' },
      ],
    }],
  },
};

test('Zita: en rad per visning, med salong, slut efter speltiden och egen filmsida', () => {
  const rader = zitaRader(ZITA);
  assert.equal(rader.length, 3);
  const degaulle = rader.find((r) => r.title.startsWith('De Gaulle') && r.venue_raw === 'Salong 1');
  assert.equal(stockholm(degaulle.starts_at), '2026-10-04 18:00:00');
  assert.equal(stockholm(degaulle.ends_at), '2026-10-04 20:40:00');
  assert.equal(degaulle.url, 'https://zita.se/filmer/motstandets-pris');
  assert.equal(degaulle.category, 'film');
  assert.equal(new Set(rader.map((r) => r.external_id)).size, 3);
});

test('Zita: barnens bio är barn, inte film', () => {
  const barn = zitaRader(ZITA).find((r) => r.title.startsWith('Skattkartan'));
  assert.equal(barn.category, 'barn');
  assert.match(barn.description, /Regi: Rune Andréasson/);
});

// --- Bio Rio ----------------------------------------------------------------

const RIO = `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Movie', '@id': 'https://www.biorio.se/sv/filmer/digger#movie',
  name: 'Digger', description: 'Oscarbelönade filmskaparen Alejandro G. Iñárritu.',
  image: 'https://rio.ams3.digitaloceanspaces.com/biorio/digger.jpg',
  director: { '@type': 'Person', name: 'Alejandro G. Iñárritu' },
})}</script>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: [{
    '@type': 'ListItem', position: 1, item: {
      '@type': 'ScreeningEvent', name: 'Digger - Visning', description: 'Se Digger på Bio Rio',
      startDate: '2026-10-04T08:30:00.000Z', endDate: '2026-10-04T10:38:00.000Z',
      workPresented: { '@type': 'Movie', '@id': 'https://www.biorio.se/sv/filmer/digger#movie', name: 'Digger' },
      offers: { '@type': 'Offer', url: 'https://www.biorio.se/sv/boka/2767', price: 150, priceCurrency: 'SEK' },
    },
  }],
})}</script>`;

test('Bio Rio: titel, text och bild från filmen, inte från visningen', () => {
  const [rad] = screeningsFromPage(RIO, 'https://www.biorio.se/sv/filmer/digger');
  assert.equal(rad.title, 'Digger');
  assert.match(rad.description, /^Regi: Alejandro G\. Iñárritu\. Oscarbelönade/);
  assert.equal(rad.image_url, 'https://rio.ams3.digitaloceanspaces.com/biorio/digger.jpg');
  assert.equal(stockholm(rad.starts_at), '2026-10-04 10:30:00');
  assert.equal(rad.price_min, 150);
  assert.equal(rad.category, 'film');
  assert.equal(rad.external_id, 'digger/202610040830');
});

test('Bio Rio: filmerna ur startsidans länkar, var och en en gång', () => {
  const html = '<a href="/sv/filmer/digger">a</a><a href="/sv/filmer/digger">b</a><a href="/sv/om-oss">c</a>';
  assert.deepEqual(filmUrls(html), ['https://www.biorio.se/sv/filmer/digger']);
});

// --- Cinemateket ------------------------------------------------------------

test('Cinemateket: tiderna ur kalenderlänken, titeln ur den synliga länken', async () => {
  const { rowsFromList } = await import('../scanner/sources/cinemateket.mjs');
  const html = `<h3 class="date-heading">Söndag den 4 oktober</h3>
    <div class="article-tickets article__border">
      <a href="/sv/se-och-samtala-om-film/cinemateket-stockholm/filmer/?filmId=7700&cityId=1" class="article-tickets__meta-item margin-lg-b-1">
        <span class="underline">Landskap efter striden, Andrzej Wajda (35 mm)</span></a><br/>
      <a class="article-tickets__purchase-btn margin-xs-b-1" href="https://bio.se/biografer/filmhuset/20261004/1600/Victor" target="_blank">Köp</a>
      <time>sön 4/10 kl. 16:00</time>
      <a href="/sv/se-och-samtala-om-film/cinemateket-stockholm/filmer/iCal?eventId=7700&amp;title=Krajobraz po bitwie&amp;startDate=2026-10-04 16:00:00&amp;endDate=2026-10-04 18:10:00&amp;location=Filmhuset - Bio Victor&amp;city=1" class="article-tickets__meta-item">Lägg till</a>
    </div>`;
  const [rad] = rowsFromList(html);
  assert.equal(rad.title, 'Landskap efter striden');
  assert.equal(stockholm(rad.starts_at), '2026-10-04 16:00:00');
  assert.equal(stockholm(rad.ends_at), '2026-10-04 18:10:00');
  assert.equal(rad.venue_raw, 'Bio Victor');
  assert.match(rad.description, /Regi: Andrzej Wajda · Originaltitel: Krajobraz po bitwie · Visas på 35 mm/);
  assert.equal(rad.ticket_url, 'https://bio.se/biografer/filmhuset/20261004/1600/Victor');
  assert.equal(rad.url, 'https://www.filminstitutet.se/sv/se-och-samtala-om-film/cinemateket-stockholm/filmer/?filmId=7700&cityId=1');
});

test('Cinemateket: en kortfilm före hör till titeln, inte till regissören', async () => {
  const { delaTitel } = await import('../scanner/sources/cinemateket.mjs');
  assert.deepEqual(delaTitel('En farlig kvinna, A.E. Green + Betty flyttar'),
    { titel: 'En farlig kvinna + Betty flyttar', regi: 'A.E. Green', format: null });
  assert.equal(delaTitel('Histoire(s) du cinéma 2a & Orphée, Godard, Cocteau').regi, 'Godard, Cocteau');
});

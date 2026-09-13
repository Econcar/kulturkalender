import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  bestOffer, category, eventStatus, eventsFromHtml, imageUrl,
  parseDateTime, placeAddress, placeName, toEvent,
} from '../lib/event.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

test('Kulturhusets riktiga block läses helt', () => {
  const [event] = eventsFromHtml(fixture('kulturhuset-konsert.html'));

  assert.equal(event.title, 'Fatoumata Diawara');
  assert.equal(event.starts_at, '2026-10-17T18:00:00.000Z'); // 20:00 svensk sommartid
  assert.equal(event.ends_at, '2026-10-17T20:00:00.000Z');
  assert.equal(event.venue_raw, 'Studion, plan 1');
  assert.equal(event.address, 'Sergels torg, Stockholm');
  assert.equal(event.price_min, 550);
  assert.equal(event.price_max, 550);
  assert.equal(event.currency, 'SEK');
  assert.equal(event.ticket_url, 'https://tix.kulturhusetstadsteatern.se/sv/buyingflow/tickets/31768/');
  assert.equal(event.organizer, 'Kulturhuset Stadsteatern');
  assert.equal(event.status, 'scheduled');
  assert.ok(event.description.startsWith('Hyllade maliska sångerskan'));
});

test('Kulturhusets generiska @type räddas av genretexten', () => {
  // Sajten skriver @type: "Event" och lägger "Konserter" i genre. Missar vi
  // det hamnar hela deras konsertprogram under "övrigt", och kategorifiltret
  // – sidans viktigaste funktion – slutar fungera för den största källan.
  const [event] = eventsFromHtml(fixture('kulturhuset-konsert.html'));
  assert.equal(event.category, 'konsert');
});

test('evenemanget hittas inuti ett @graph', () => {
  const [event] = eventsFromHtml(fixture('evenemang-graph.html'), {
    sourceUrl: 'https://exempel.se/repertoar/parzival',
  });

  assert.equal(event.title, 'Parzival');
  assert.equal(event.category, 'teater');
  assert.equal(event.venue_raw, 'Stora scenen');
  assert.equal(event.address, 'Nybroplan, 111 47, Stockholm');
  // Relativ bildadress löses mot sidans adress.
  assert.equal(event.image_url, 'https://exempel.se/bilder/parzival.jpg');
  // HTML i beskrivningen städas bort – sajter lägger taggar i ld+json ändå.
  assert.equal(event.description, 'En uppsättning om riddaren som söker Graal.');
});

test('flera offers blir ett prisintervall', () => {
  const [event] = eventsFromHtml(fixture('evenemang-graph.html'));
  assert.equal(event.price_min, 250);
  assert.equal(event.price_max, 650);
  assert.equal(event.ticket_url, 'https://exempel.se/biljetter/parzival');
});

test('flera evenemang på samma sida läses var för sig', () => {
  const events = eventsFromHtml(fixture('evenemang-array.html'));

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.title), ['Nattjazz', 'Kvartetten']);
  // @type som array ska fortfarande räknas som MusicEvent.
  assert.equal(events[0].category, 'konsert');
  assert.equal(events[1].status, 'cancelled');
});

test('ett trasigt block fäller inte de andra', () => {
  const events = eventsFromHtml(fixture('evenemang-array.html'));
  assert.ok(events.every((e) => e.title !== 'Trasig'));
});

test('en nod utan titel eller starttid ger null, inte en halv rad', () => {
  assert.equal(toEvent({ '@type': 'Event', startDate: '2026-09-18T19:00:00' }), null);
  assert.equal(toEvent({ '@type': 'Event', name: 'Utan tid' }), null);
  assert.equal(toEvent(null), null);
  assert.equal(toEvent('inte ett objekt'), null);
});

// ---------------------------------------------------------------------------
// Tidszonen. Anledningen till att parseDateTime inte bara är new Date().
// ---------------------------------------------------------------------------

test('zonlös tid tolkas som Stockholm, inte som serverns zon', () => {
  // Dramaten skriver så här. Skannern kör på GitHub Actions i UTC. Utan den
  // uttalade zonen hade 19:00 blivit 19:00Z, alltså visats som 21:00 i listan.
  assert.equal(parseDateTime('2026-09-18T19:00:00'), '2026-09-18T17:00:00.000Z');
});

test('sommartid och vintertid ger olika offset', () => {
  assert.equal(parseDateTime('2026-07-01T19:00:00'), '2026-07-01T17:00:00.000Z'); // CEST, +2
  assert.equal(parseDateTime('2026-01-15T19:00:00'), '2026-01-15T18:00:00.000Z'); // CET,  +1
});

test('uttalad zon respekteras och räknas om till UTC', () => {
  assert.equal(parseDateTime('2026-10-17T20:00:00+02:00'), '2026-10-17T18:00:00.000Z');
  assert.equal(parseDateTime('2026-10-17T18:00:00Z'), '2026-10-17T18:00:00.000Z');
  assert.equal(parseDateTime('2026-10-17T20:00:00+0200'), '2026-10-17T18:00:00.000Z');
});

test('datum utan klockslag blir midnatt svensk tid', () => {
  assert.equal(parseDateTime('2026-06-01'), '2026-05-31T22:00:00.000Z');
});

test('skräp ger null i stället för Invalid Date', () => {
  assert.equal(parseDateTime('i höst'), null);
  assert.equal(parseDateTime(''), null);
  assert.equal(parseDateTime(null), null);
  assert.equal(parseDateTime('2026-13-45T99:00:00'), null);
});

// ---------------------------------------------------------------------------
// Delarna var för sig
// ---------------------------------------------------------------------------

test('kategorin tas från @type före genretexten', () => {
  assert.equal(category({ '@type': 'TheaterEvent', genre: 'Höstens program' }), 'teater');
  assert.equal(category({ '@type': 'MusicEvent' }), 'konsert');
  assert.equal(category({ '@type': 'Event', genre: 'Utställningar' }), 'utställning');
  assert.equal(category({ '@type': 'Event' }), 'övrigt');
  assert.equal(category({}), 'övrigt');
});

test('det smalare ordet vinner när flera passar', () => {
  // "Operakonsert" är opera, inte konsert. Ordningen i GENRE_CATEGORY avgör,
  // och den är medveten.
  assert.equal(category({ '@type': 'Event', genre: 'Operakonsert' }), 'opera');

  // "Barnteater" blir barn, inte teater. Publik slår form: den som filtrerar
  // på barn blir illa betjänad av att missa barnteatern, medan den som
  // filtrerar på teater missar en föreställning hen ändå inte skulle gå på.
  assert.equal(category({ '@type': 'Event', keywords: 'Barnteater, familj' }), 'barn');
});

test('gratis är ett pris, saknat pris är det inte', () => {
  assert.deepEqual(bestOffer({ price: '0', priceCurrency: 'SEK' }), {
    min: 0, max: 0, currency: 'SEK', url: null,
  });
  assert.deepEqual(bestOffer(undefined), { min: null, max: null, currency: null, url: null });
});

test('lowPrice och highPrice räknas med', () => {
  const offer = bestOffer({ lowPrice: 120, highPrice: 480, priceCurrency: 'SEK' });
  assert.equal(offer.min, 120);
  assert.equal(offer.max, 480);
});

test('platsen kan vara ett objekt eller bara en sträng', () => {
  assert.equal(placeName('Lilla salen'), 'Lilla salen');
  assert.equal(placeName({ '@type': 'Place', name: 'Stora salen' }), 'Stora salen');
  assert.equal(placeName(null), null);
  assert.equal(placeAddress({ address: 'Sveavägen 1' }), 'Sveavägen 1');
  assert.equal(placeAddress({}), null);
});

test('okänd eventStatus tolkas som planerat, inte som inställt', () => {
  // Att gissa "inställt" på ett värde vi inte känner igen döljer evenemang som
  // faktiskt blir av. Fel åt det hållet är dyrare.
  assert.equal(eventStatus('https://schema.org/EventNågotNytt'), 'scheduled');
  assert.equal(eventStatus(null), 'scheduled');
  assert.equal(eventStatus('https://schema.org/EventCancelled'), 'cancelled');
  assert.equal(eventStatus('https://schema.org/EventPostponed'), 'postponed');
});

test('bilden kan vara sträng, array eller ImageObject', () => {
  assert.equal(imageUrl('https://exempel.se/a.jpg'), 'https://exempel.se/a.jpg');
  assert.equal(imageUrl(['https://exempel.se/a.jpg', 'https://exempel.se/b.jpg']), 'https://exempel.se/a.jpg');
  assert.equal(imageUrl({ '@type': 'ImageObject', url: 'https://exempel.se/c.jpg' }), 'https://exempel.se/c.jpg');
  assert.equal(imageUrl(null), null);
  assert.equal(imageUrl('inte en url'), null);
});

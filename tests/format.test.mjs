import test from 'node:test';
import assert from 'node:assert/strict';

import { dayKey, dayHeading, daysSince, fetched, groupByDay, price, time, today, utdrag, venueLabel } from '../public/format.js';

test('huset skrivs före rummet', () => {
  assert.equal(venueLabel('Dramaten', 'Stora scenen'), 'Dramaten, Stora scenen');
  assert.equal(venueLabel('Kulturhuset Stadsteatern', 'Studion, plan 1'),
    'Kulturhuset Stadsteatern, Studion, plan 1');
});

test('saknas rummet skrivs bara huset', () => {
  assert.equal(venueLabel('Dramaten', null), 'Dramaten');
  assert.equal(venueLabel('Dramaten', ''), 'Dramaten');
  assert.equal(venueLabel('Dramaten', '   '), 'Dramaten');
});

test('samma namn två gånger skrivs en gång', () => {
  // Kulturhuset har evenemang där rummet inte är utsatt och källan upprepar
  // husets namn. "Kulturhuset, Kulturhuset" ser ut som ett fel.
  assert.equal(venueLabel('Kulturhuset', 'Kulturhuset'), 'Kulturhuset');
  assert.equal(venueLabel('Dramaten', 'dramaten'), 'Dramaten');
});

test('saknas huset duger rummet', () => {
  assert.equal(venueLabel(null, 'Stora scenen'), 'Stora scenen');
  assert.equal(venueLabel(null, null), '');
});

test('tiden visas som svensk tid, inte som UTC', () => {
  // API:et lämnar UTC. Står det 18:00Z i databasen ska listan säga 20:00 –
  // det var klockslaget arrangören annonserade.
  assert.equal(time('2026-10-17T18:00:00.000Z'), '20:00');
  assert.equal(time('2026-01-15T18:00:00.000Z'), '19:00'); // vintertid
});

test('dagsnyckeln följer svensk tid, inte UTC-dygnet', () => {
  // En konsert 00:30 svensk tid ligger 22:30 UTC dagen innan. Grupperas den
  // på UTC-datumet hamnar den under fel dag i listan.
  assert.equal(dayKey('2026-06-30T22:30:00.000Z'), '2026-07-01');
});

test('i dag och i morgon skrivs ut med ord', () => {
  const nu = new Date('2026-10-17T09:00:00.000Z');
  assert.equal(dayHeading('2026-10-17T18:00:00.000Z', nu), 'I dag');
  assert.equal(dayHeading('2026-10-18T18:00:00.000Z', nu), 'I morgon');
  assert.match(dayHeading('2026-10-24T18:00:00.000Z', nu), /oktober/);
});

test('priset skiljer på gratis och okänt', () => {
  assert.equal(price(0, 0), 'Fri entré');
  assert.equal(price(0, null), 'Fri entré');
  assert.equal(price(null, null), '');
  assert.equal(price(undefined, undefined), '');
});

test('intervall skrivs bara ut när det finns ett', () => {
  assert.equal(price(550, 550), '550 kr');
  assert.equal(price(550, null), '550 kr');
  assert.equal(price(250, 650), '250–650 kr');
});

test('annan valuta skrivs med sin kod', () => {
  assert.equal(price(20, 20, 'EUR'), '20 EUR');
});

test('utdraget kapas vid en mening när det går', () => {
  const text = 'Hyllade maliska sångerskan Fatoumata Diawara har etablerat sig '
    + 'som en av Afrikas mest inflytelserika röster. Den 17 oktober spelar hon '
    + 'i Stockholm, och det blir hennes enda svenska konsert i år.';
  const ut = utdrag(text, 120);

  assert.equal(ut, 'Hyllade maliska sångerskan Fatoumata Diawara har etablerat sig som en av Afrikas mest inflytelserika röster.');
  assert.ok(ut.length <= 120);
});

test('en mycket kort första mening ger ordkapning i stället', () => {
  // Spärren på halva längden finns för att "Kort." inte är ett utdrag. Hellre
  // en avhuggen mening som visar vad texten handlar om än en fullständig som
  // inte gör det.
  const text = 'Kort. Andra meningen fortsätter och fortsätter och blir till '
    + 'slut så lång att den måste kapas någonstans på vägen.';
  const ut = utdrag(text, 60);

  assert.ok(ut.startsWith('Kort. Andra meningen'));
  assert.ok(ut.endsWith('…'));
});

test('utdraget kapas vid ett ord när ingen mening finns', () => {
  const ut = utdrag('ett två tre fyra fem sex sju åtta nio tio elva tolv', 20);
  assert.ok(ut.endsWith('…'));
  assert.ok(!ut.includes('fyra fem sex sju'));
});

test('kort text lämnas i fred', () => {
  assert.equal(utdrag('Kort.', 180), 'Kort.');
  assert.equal(utdrag(null), '');
});

test('grupperingen behåller API:ets ordning', () => {
  const events = [
    { title: 'A', starts_at: '2026-10-17T16:00:00.000Z' },
    { title: 'B', starts_at: '2026-10-17T18:00:00.000Z' },
    { title: 'C', starts_at: '2026-10-18T18:00:00.000Z' },
  ];

  const dagar = groupByDay(events);

  assert.equal(dagar.length, 2);
  assert.deepEqual(dagar[0].events.map((e) => e.title), ['A', 'B']);
  assert.deepEqual(dagar[1].events.map((e) => e.title), ['C']);
});

test('rader med trasigt datum hoppas över i stället för att fälla listan', () => {
  const dagar = groupByDay([
    { title: 'Trasig', starts_at: 'i höst' },
    { title: 'Bra', starts_at: '2026-10-17T18:00:00.000Z' },
  ]);

  assert.equal(dagar.length, 1);
  assert.deepEqual(dagar[0].events.map((e) => e.title), ['Bra']);
});

test('tom lista ger tom gruppering, inte fel', () => {
  assert.deepEqual(groupByDay([]), []);
  assert.deepEqual(groupByDay(null), []);
});

// --- Dagens datum och hur färska uppgifterna är ----------------------------

test('dagens datum skrivs ut med veckodag och år', () => {
  assert.equal(today(new Date('2026-09-15T08:00:00Z')), 'Tisdag 15 september 2026');
});

test('datumet är Stockholms, inte besökarens', () => {
  // Strax efter midnatt svensk tid är det fortfarande dagen före i UTC. Sidan
  // ska säga vilken dag det är i Stockholm – det är där evenemangen går.
  assert.equal(today(new Date('2026-09-14T22:30:00Z')), 'Tisdag 15 september 2026');
});

test('dygn räknas i kalenderdagar, inte i timmar', () => {
  const nu = new Date('2026-09-15T08:00:00Z');
  // En och en halv timme isär, men två olika dagar i Stockholm.
  assert.equal(daysSince('2026-09-14T21:30:00Z', nu), 1);
  assert.equal(daysSince('2026-09-15T04:00:00Z', nu), 0);
  assert.equal(daysSince('2026-09-08T04:00:00Z', nu), 7);
});

test('nyss hämtat skrivs som i dag med klockslag', () => {
  const nu = new Date('2026-09-15T08:00:00Z');
  assert.equal(fetched('2026-09-15T02:12:00Z', nu), 'hämtad i dag 04:12');
  assert.equal(fetched('2026-09-14T17:41:00Z', nu), 'hämtad i går 19:41');
});

test('äldre hämtningar säger hur gamla de är', () => {
  // Skannern går varje natt, så ett datum flera dagar tillbaka är ett fel och
  // inte en detalj. Besökaren ska slippa räkna dagar i huvudet för att se det.
  const nu = new Date('2026-09-15T08:00:00Z');
  assert.equal(fetched('2026-09-08T02:00:00Z', nu), 'hämtad 8 september – för 7 dagar sedan');
});

test('en framtida tidsstämpel påstår inte att den är gammal', () => {
  // Klockan hos källan kan gå fel, och "för -1 dagar sedan" ser ut som en bugg
  // i sidan snarare än i data.
  const nu = new Date('2026-09-15T08:00:00Z');
  assert.equal(fetched('2026-09-15T20:00:00Z', nu), 'hämtad i dag 22:00');
});

test('saknad hämtningstid skrivs inte ut alls', () => {
  // Tom sträng, så att raden faller tillbaka på bara datumet. Att hitta på en
  // tid vore att påstå något vi inte vet.
  assert.equal(fetched(null), '');
  assert.equal(fetched(undefined), '');
  assert.equal(fetched('inte ett datum'), '');
});

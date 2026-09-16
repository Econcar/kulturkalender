import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import konserthuset, {
  cards, categoryFor, eventsFromCalendar, externalId, kalenderTillstånd, parseCard,
} from '../scanner/sources/konserthuset.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

const KALENDER = fixture('konserthuset-kalender.html');
const KLUMP = fixture('konserthuset-klump.html');

const rad = (rader, titel) => rader.find((r) => r.title === titel);

test('en klump ger en rad per föreställning', () => {
  const rader = eventsFromCalendar(KLUMP);

  // Fem kort, fyra rader: det utan starttid faller bort. Ett evenemang utan
  // tid går varken att visa eller sortera – samma regel som lib/event.mjs.
  assert.equal(cards(KLUMP).length, 5);
  assert.equal(rader.length, 4);
  assert.ok(!rad(rader, 'Annonserad utan datum'), 'kortet utan datum kom med');
});

test('titeln är rubriken, inte salen eller tonsättaren', () => {
  // itemprop="name" står tre gånger i samma kort: rubriken, "Stora salen" och
  // "Robert Schumann". En läsare som tar första bästa name hämtar ibland
  // tonsättaren som titel, och felet syns bara på de korten.
  const r = rad(eventsFromCalendar(KLUMP), 'Schumanns tredje symfoni');

  assert.ok(r, 'hittade inte Schumann-konserten');
  assert.equal(r.venue_raw, 'Stora salen');
  assert.ok(!/Robert Schumann/.test(r.title));
});

test('beskrivningen är teasern, inte bildens alt-text', () => {
  // itemprop="description" står också på bilden, med texten "Man som ler.
  // Fotografi.". Den är en bildbeskrivning för skärmläsare, inte en text om
  // konserten, och den vore obegriplig i listan.
  const r = rad(eventsFromCalendar(KLUMP), 'Schumanns tredje symfoni');

  assert.match(r.description, /^Kungliga Filharmonikerna utan dirigent/);
  assert.ok(!/Man som ler/.test(r.description));
});

test('tiderna tolkas som Stockholm, inte som UTC', () => {
  // Kalendern skriver "2026-09-16 18:00:00" utan zon. Skannern kör i UTC på
  // GitHub Actions, så utan parseDateTime hade konserten hamnat 18 UTC i
  // databasen och visats som 20 i listan – ett fel som ser rimligt ut.
  const r = rad(eventsFromCalendar(KLUMP), 'Schumanns tredje symfoni');

  assert.equal(r.starts_at, '2026-09-16T16:00:00.000Z');
  assert.equal(r.ends_at, '2026-09-16T17:10:00.000Z');
});

test('priset läses som intervall, inte som första talet', () => {
  // "150-420 kr" med parseFloat ger 150, och listan lovar då en biljett för
  // en tredjedel av vad den dyraste kostar.
  const rader = eventsFromCalendar(KLUMP);

  const schumann = rad(rader, 'Schumanns tredje symfoni');
  assert.equal(schumann.price_min, 150);
  assert.equal(schumann.price_max, 420);

  // Ett enda pris ger samma min och max, inte ett spann mot noll.
  const mini = rad(rader, 'MINI med brass');
  assert.equal(mini.price_min, 120);
  assert.equal(mini.price_max, 120);
});

test('saknad prisrad blir null, aldrig noll', () => {
  // Fri entré och okänt pris är olika saker. Skriver vi noll står det
  // "Fri entré" i listan, och någon står i dörren utan pengar.
  const visning = rad(eventsFromCalendar(KLUMP), 'Konserthusets konst och arkitektur');

  assert.equal(visning.price_min, null);
  assert.equal(visning.price_max, null);
});

test('external_id är slug och tidpunkt, inte slugen ensam', () => {
  // Samma konsert spelas flera kvällar och delar slug. Utan tidpunkten i id:t
  // skriver kvällarna över varandra i upserten och listan visar en enda.
  assert.equal(
    externalId('https://www.konserthuset.se/program-och-biljetter/kalender/konsert/2026/mini-med-brass/20260919-1000/'),
    'mini-med-brass/20260919-1000',
  );
  assert.notEqual(
    externalId('https://www.konserthuset.se/program-och-biljetter/kalender/konsert/2026/mini-med-brass/20260919-1000/'),
    externalId('https://www.konserthuset.se/program-och-biljetter/kalender/konsert/2026/mini-med-brass/20260919-1130/'),
  );

  const idn = new Set(eventsFromCalendar(KLUMP).map((r) => r.external_id));
  assert.equal(idn.size, 4, 'föreställningarna delade external_id');
});

test('kategorin kommer ur husets egna etiketter', () => {
  const rader = eventsFromCalendar(KLUMP);

  assert.equal(rad(rader, 'Schumanns tredje symfoni').category, 'konsert');
  assert.equal(rad(rader, 'MINI med brass').category, 'barn');
  assert.equal(rad(rader, 'Stockholm Craft Week').category, 'utställning');
  // En guidad visning av huset är inte en utställning, trots genren
  // "Konst och arkitektur".
  assert.equal(rad(rader, 'Konserthusets konst och arkitektur').category, 'övrigt');
});

test('konsert är standardvärdet, inte övrigt', () => {
  // Huset är en konsertscen. En okänd genre är med all sannolikhet en konsert,
  // och övrigt är en sämre gissning än den uppenbara. Samma resonemang som
  // Dramaten gör med teater.
  assert.equal(categoryFor('/kalender/konsert/2026/x/20260101-1900/', 'Nygammal genre'), 'konsert');
  assert.equal(categoryFor('/kalender/extern-konsert/2026/x/20260101-1900/', null), 'konsert');
});

test('bilden blir en absolut adress med storleken kvar', () => {
  // Kortet länkar relativt och med storleksparametrar. Utan absolut adress
  // pekar bilden på vår egen domän; utan parametrarna hämtas originalet,
  // som är tio gånger så stort.
  const r = rad(eventsFromCalendar(KLUMP), 'Schumanns tredje symfoni');

  assert.match(r.image_url, /^https:\/\/www\.konserthuset\.se\/globalassets\//);
  assert.match(r.image_url, /width=626/);
  // &amp; i markupen ska vara & i adressen.
  assert.ok(!r.image_url.includes('&amp;'));
});

test('kalendersidan ger contentGuid och utgångsdatum', () => {
  const { guid, date } = kalenderTillstånd(KALENDER);

  assert.equal(guid, '7734c4c5-5c58-4872-a98b-6b5501531aca');
  assert.equal(date, '2026-09-15 15:50:48');
});

test('utan startdatum i markupen används dagens datum i Stockholm', () => {
  // Strax efter midnatt svensk tid är det fortfarande dagen före i UTC, och
  // skannern kör i UTC. Frågar vi efter fel dag tappar vi kvällens konserter.
  const { date } = kalenderTillstånd('<div id="contentGuid" data-contentguid="abc"></div>', {
    now: new Date('2026-09-14T22:30:00Z'),
  });

  assert.equal(date, '2026-09-15 00:00:00');
});

test('klumparna hämtas tills sajten säger att de är slut', async () => {
  const anrop = [];
  const rader = await konserthuset.fetchEvents({
    log: () => {},
    paus: async () => {},
    robotsOk: async () => true,
    hämta: async () => KALENDER,
    take: 5,
    laddaMer: async (args) => {
      anrop.push(args);
      // Andra klumpen är samma kort igen – så beter sig kalendern när den
      // skiftar mellan två anrop, och raderna får inte dubbleras av det.
      return { html: KLUMP, hideSelf: anrop.length > 1 };
    },
  });

  assert.equal(anrop.length, 2);
  assert.deepEqual(anrop.map((a) => a.skip), [0, 5]);
  assert.equal(anrop[0].guid, '7734c4c5-5c58-4872-a98b-6b5501531aca');
  assert.equal(rader.length, 4, 'dubbletterna mellan klumparna kom med');
});

test('kort som inte går att tolka larmar i stället för att tystna', async () => {
  // Skillnaden mot ett tomt program: korten finns, men markupen är en annan.
  // Utan kontrollen skulle skannern skriva noll rader varje natt och
  // Konserthuset bara se tomt ut i listan.
  await assert.rejects(
    () => konserthuset.fetchEvents({
      log: () => {},
      paus: async () => {},
      robotsOk: async () => true,
      hämta: async () => KALENDER,
      take: 4,
      laddaMer: async () => ({ html: '<li id="page-1"></li>'.repeat(4), hideSelf: true }),
    }),
    /gick att tolka/,
  );
});

test('en kalender utan kort är också ett larm', async () => {
  await assert.rejects(
    () => konserthuset.fetchEvents({
      log: () => {},
      paus: async () => {},
      robotsOk: async () => true,
      hämta: async () => KALENDER,
      laddaMer: async () => ({ html: '', hideSelf: true }),
    }),
    /inga kort/,
  );
});

test('robots.txt kollas före varje svep, inte en gång i september', async () => {
  const kollade = [];
  await assert.rejects(
    () => konserthuset.fetchEvents({
      log: () => {},
      paus: async () => {},
      robotsOk: async (url) => {
        kollade.push(url);
        return false;
      },
      hämta: async () => KALENDER,
      laddaMer: async () => ({ html: KLUMP }),
    }),
    /robots\.txt/,
  );
  assert.ok(kollade.length >= 1);
});

test('en sida utan contentGuid stoppar svepet', async () => {
  // Guid:et identifierar kalenderblocket. Saknas det har sidan lagts om, och
  // att posta utan det ger ett tomt svar som ser ut som ett tomt program.
  await assert.rejects(
    () => konserthuset.fetchEvents({
      log: () => {},
      paus: async () => {},
      robotsOk: async () => true,
      hämta: async () => '<html><body>ingen kalender här</body></html>',
      laddaMer: async () => ({ html: KLUMP }),
    }),
    /contentGuid/,
  );
});

test('ett tomt kort ger null och inte en halv rad', () => {
  assert.equal(parseCard(''), null);
  assert.equal(parseCard('<li id="page-1" data-fulltime="2026-09-16 18:00:00"></li>'), null);
});

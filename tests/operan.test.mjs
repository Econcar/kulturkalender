import test from 'node:test';
import assert from 'node:assert/strict';

import operan, {
  bildUrl, categoryFor, flattenMonth, månadsnycklar, productionContent, toRow,
} from '../scanner/sources/operan.mjs';

// Formen är API:ets egen, nedkortad till de fält adaptern läser.
const ORDLISTA = { 'Facility.17': 'Stora scenen', 'Facility.61': 'Guldfoajén' };

const INNEHÅLL = {
  1030: {
    name: 'Tosca',
    url: '/forestallningar/tosca',
    description: '<p><em>Tosca</em> är operan som har allt.</p>',
    genres: ['Opera'],
    listingImageHtml: '<picture><source srcset="/media/hfnfaksc/tosca.jpg?width=450&amp;height=300" media="(min-width:960px)" /><img alt="Tosca" src="/media/hfnfaksc/tosca.jpg?width=320&amp;height=200&amp;format=webp" width="320" /></picture>',
    performanceOverrides: [
      { performanceId: 9919, description: '<p><strong>Nypremiär</strong> av Tosca.</p>' },
    ],
  },
  8370: {
    name: 'Introduktioner & samtal',
    url: '/forestallningar/introduktioner-samtal',
    description: '<p>Möt husets konstnärer.</p>',
    genres: ['Publikintroduktion'],
  },
};

const tillfälle = (över = {}) => ({
  performanceId: 9920,
  productionId: 1030,
  performanceDate: '2026-09-18T17:00:00+00:00',
  availability: 214,
  seatMapId: 17,
  facilityId: 17,
  ...över,
});

const rad = (över) => toRow(tillfälle(över), { innehåll: INNEHÅLL, ordlista: ORDLISTA });

test('månadsnycklarna går tolv månader framåt och över årsskiftet', () => {
  const nycklar = månadsnycklar(new Date('2026-11-15T09:00:00Z'), 4);

  assert.deepEqual(nycklar, ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']);
  assert.equal(månadsnycklar(new Date('2026-09-15T09:00:00Z')).length, 12);
});

test('månaden räknas i Stockholm, inte i UTC', () => {
  // 1 januari 00:30 svensk tid är fortfarande 31 december i UTC. Svepet skulle
  // då börja i en månad som redan är slut, och januari falla bort på slutet.
  const [första] = månadsnycklar(new Date('2026-12-31T23:30:00Z'), 1);

  assert.equal(första, '2027-01-01');
});

test('månadssvaret plattas till en lista av speltillfällen', () => {
  const dagar = [
    { date: '2026-09-18T00:00:00+00:00', performances: [tillfälle(), tillfälle({ performanceId: 9921 })] },
    { date: '2026-09-19T00:00:00+00:00', performances: [tillfälle({ performanceId: 9922 })] },
    { date: '2026-09-20T00:00:00+00:00', performances: [] },
  ];

  assert.equal(flattenMonth(dagar).length, 3);
  assert.equal(flattenMonth([]).length, 0);
  assert.equal(flattenMonth(null).length, 0);
});

test('trasiga speltillfällen faller bort i plattningen', () => {
  const dagar = [{
    performances: [
      tillfälle(),
      { performanceId: 1 },                       // utan datum
      { performanceDate: '2026-09-18T17:00:00Z' }, // utan id
      null,
    ],
  }];

  assert.equal(flattenMonth(dagar).length, 1);
});

test('tiden är UTC och räknas inte om en gång till', () => {
  // API:et skriver 17:00+00:00 för den föreställning sajten visar som 19:00.
  // Zonen står i strängen; tolkar man den som svensk väggtid blir kvällen
  // två timmar fel och ser ändå rimlig ut.
  assert.equal(rad().starts_at, '2026-09-18T17:00:00.000Z');
});

test('external_id är speltillfället, inte uppsättningen', () => {
  // Tosca spelas sexton kvällar. Med produktionens id hade femton skrivit
  // över varandra i upserten och listan visat en enda.
  assert.equal(rad().external_id, '9920');
  assert.notEqual(rad({ performanceId: 9921 }).external_id, rad().external_id);
});

test('salen slås upp i ordlistan', () => {
  assert.equal(rad().venue_raw, 'Stora scenen');
  assert.equal(rad({ facilityId: 61 }).venue_raw, 'Guldfoajén');
  // En sal som saknas i ordlistan ger null, inte "Facility.99".
  assert.equal(rad({ facilityId: 99 }).venue_raw, null);
});

test('kvällens egen text vinner över uppsättningens', () => {
  // Nypremiären har en text som gäller just den kvällen. Uppsättningens
  // allmänna text är rätt för de andra femton.
  assert.match(rad({ performanceId: 9919 }).description, /Nypremiär/);
  assert.match(rad().description, /operan som har allt/);
});

test('texten städas från HTML', () => {
  assert.ok(!rad().description.includes('<'));
});

test('utan namn blir det ingen rad', () => {
  // Ett speltillfälle vars uppsättning saknas i innehålls-API:et går inte att
  // visa. En rad med tid men utan titel är sämre än ingen rad alls.
  assert.equal(toRow(tillfälle({ productionId: 99999 }), { innehåll: INNEHÅLL }), null);
  assert.equal(toRow(tillfälle({ performanceDate: null }), { innehåll: INNEHÅLL }), null);
  assert.equal(toRow(null, { innehåll: INNEHÅLL }), null);
});

test('bilden tas ur img-taggen, inte ur srcset', () => {
  // source-elementets srcset är storbildsvarianten för breda skärmar. Listan
  // visar en tumnagel, och 450 px i ett 64 px-hål är bara bandbredd.
  const r = rad();

  assert.equal(r.image_url, 'https://www.operan.se/media/hfnfaksc/tosca.jpg?width=320&height=200&format=webp');
  assert.ok(!r.image_url.includes('&amp;'), 'entiteterna följde med in i adressen');
});

test('saknad bild ger null, inte en trasig adress', () => {
  assert.equal(bildUrl(undefined), null);
  assert.equal(bildUrl('<picture></picture>'), null);
});

test('kategorin kommer ur husets genrer', () => {
  assert.equal(categoryFor(['Opera']), 'opera');
  assert.equal(categoryFor(['Operett']), 'opera');
  assert.equal(categoryFor(['Balett/dans']), 'dans');
  assert.equal(categoryFor(['Konsert']), 'konsert');
  assert.equal(categoryFor(['Visning']), 'övrigt');
  assert.equal(categoryFor(['Publikintroduktion']), 'föreläsning');
});

test('barn vinner över genren den står bredvid', () => {
  // En familjeföreställning hör hemma under barn. Den som filtrerar på barn
  // letar efter just den, och under opera hittar ingen den.
  assert.equal(categoryFor(['Opera', 'Barn & unga']), 'barn');
});

test('okänd genre blir opera, inte övrigt', () => {
  // Det är ett operahus. En ny genreetikett är med all sannolikhet opera, och
  // övrigt är en sämre gissning än den uppenbara.
  assert.equal(categoryFor(['Nygammal genre']), 'opera');
  assert.equal(categoryFor([]), 'opera');
});

test('priset gissas inte fram ur antalet lediga platser', () => {
  // API:et bär availability, alltså platser kvar. Att räkna om det till ett
  // pris vore att hitta på.
  const r = rad();

  assert.equal(r.price_min, null);
  assert.equal(r.price_max, null);
  assert.equal(r.ticket_url, null);
});

test('svepet hämtar månad för månad och slår ihop dem', async () => {
  const hämtade = [];
  const rader = await operan.fetchEvents({
    log: () => {},
    paus: async () => {},
    robotsOk: async () => true,
    now: new Date('2026-09-15T09:00:00Z'),
    månader: 2,
    hämtaJson: async (url) => {
      hämtade.push(url);
      if (url.endsWith('/dictionary')) return ORDLISTA;
      if (url.includes('/productions/content')) return INNEHÅLL;
      if (url.includes('date=2026-09-01')) return [{ performances: [tillfälle()] }];
      return [{ performances: [tillfälle({ performanceId: 9930, performanceDate: '2026-10-02T17:00:00+00:00' })] }];
    },
  });

  assert.equal(rader.length, 2);
  assert.ok(hämtade.some((u) => u.includes('date=2026-09-01')));
  assert.ok(hämtade.some((u) => u.includes('date=2026-10-01')));
  assert.deepEqual(rader.map((r) => r.external_id), ['9920', '9930']);
});

test('en månad som strular fäller inte hela källan', async () => {
  const rader = await operan.fetchEvents({
    log: () => {},
    paus: async () => {},
    robotsOk: async () => true,
    now: new Date('2026-09-15T09:00:00Z'),
    månader: 2,
    hämtaJson: async (url) => {
      if (url.endsWith('/dictionary')) return ORDLISTA;
      if (url.includes('/productions/content')) return INNEHÅLL;
      if (url.includes('date=2026-09-01')) throw new Error('502');
      return [{ performances: [tillfälle({ performanceId: 9930 })] }];
    },
  });

  assert.equal(rader.length, 1, 'oktober föll bort när september strulade');
});

test('utan ordlista kommer föreställningarna ändå med', async () => {
  // Salsnamnen är en upplysning, inte en förutsättning. Huset är det
  // besökaren väljer; salen hittar man på plats.
  const rader = await operan.fetchEvents({
    log: () => {},
    paus: async () => {},
    robotsOk: async () => true,
    now: new Date('2026-09-15T09:00:00Z'),
    månader: 1,
    hämtaJson: async (url) => {
      if (url.endsWith('/dictionary')) throw new Error('503');
      if (url.includes('/productions/content')) return INNEHÅLL;
      return [{ performances: [tillfälle()] }];
    },
  });

  assert.equal(rader.length, 1);
  assert.equal(rader[0].venue_raw, null);
});

test('ett tomt spelår är ett larm, inte ett tomt program', async () => {
  // Tolv månader utan ett enda speltillfälle betyder att API:et har ändrats.
  // Utan kontrollen skriver skannern noll rader varje natt och Operan ser
  // bara tom ut i listan.
  await assert.rejects(
    () => operan.fetchEvents({
      log: () => {},
      paus: async () => {},
      robotsOk: async () => true,
      månader: 2,
      hämtaJson: async (url) => (url.endsWith('/dictionary') ? ORDLISTA : []),
    }),
    /inga speltillfällen/,
  );
});

test('robots.txt kollas före svepet', async () => {
  await assert.rejects(
    () => operan.fetchEvents({
      log: () => {},
      paus: async () => {},
      robotsOk: async () => false,
      hämtaJson: async () => [],
    }),
    /robots\.txt/,
  );
});

test('innehållet hämtas i klumpar, inte som en oändlig adress', async () => {
  // Trettio uppsättningar skulle bli trettio parametrar i en enda adress.
  const anrop = [];
  await productionContent(Array.from({ length: 30 }, (_, i) => i + 1), {
    paus: async () => {},
    hämtaJson: async (url) => {
      anrop.push(url);
      return {};
    },
  });

  assert.equal(anrop.length, 2, 'trettio id skulle delas i två klumpar');
  assert.ok(anrop[0].includes('productionIds=1&productionIds=2'));
});

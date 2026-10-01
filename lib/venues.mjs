// Husen vi hämtar från.
//
// Samma rader som insert-satsen i db/schema.sql, i JS-form. Behövs för att den
// lokala servern ska kunna visa husens namn utan databas, och för att
// tests/venues.test.mjs ska kunna kräva tre saker som annars glider isär
// tyst:
//
//   1. slug här = slug i db/schema.sql
//   2. slug här = adapterns id i scanner/sources/index.mjs
//   3. varje adapter har ett hus, och varje hus har en adapter
//
// Det andra är den som gör ont om den brister: vyerna joinar venues mot
// events.source, så en adapter vars id inte finns här visar sina evenemang
// utan husnamn – och huset saknas i listan på förstasidan, alltså ser det ut
// som att vi inte bevakar en scen vi faktiskt bevakar.
//
// SQL:en är facit. Den här filen ska följa den, inte tvärtom.

export const VENUES = [
  {
    slug: 'kulturhuset',
    typ: 'teater',
    name: 'Kulturhuset Stadsteatern',
    url: 'https://kulturhusetstadsteatern.se',
    address: 'Sergels torg, 111 57 Stockholm',
  },
  {
    slug: 'dramaten',
    typ: 'teater',
    name: 'Dramaten',
    url: 'https://www.dramaten.se',
    address: 'Nybroplan, 111 47 Stockholm',
  },
  {
    slug: 'konserthuset',
    typ: 'musik',
    name: 'Konserthuset Stockholm',
    url: 'https://www.konserthuset.se',
    address: 'Hötorget 8, 111 57 Stockholm',
  },
  {
    slug: 'operan',
    typ: 'opera',
    name: 'Kungliga Operan',
    url: 'https://www.operan.se',
    address: 'Gustav Adolfs torg 2, 111 52 Stockholm',
  },
  {
    slug: 'sodrateatern',
    typ: 'musik',
    name: 'Södra Teatern',
    url: 'https://sodrateatern.com',
    address: 'Mosebacke torg 1–3, 116 46 Stockholm',
  },
  {
    slug: 'folkoperan',
    typ: 'opera',
    name: 'Folkoperan',
    url: 'https://folkoperan.se',
    address: 'Hornsgatan 72, 118 21 Stockholm',
  },
  {
    slug: 'chinateatern',
    typ: 'teater',
    name: 'China Teatern',
    url: 'https://www.chinateatern.se',
    address: 'Berzelii park 9, 111 47 Stockholm',
  },
  {
    slug: 'oscarsteatern',
    typ: 'teater',
    name: 'Oscarsteatern',
    url: 'https://www.oscarsteatern.se',
    address: 'Kungsgatan 63, 111 22 Stockholm',
  },
  {
    slug: 'intiman',
    typ: 'teater',
    name: 'Intiman',
    url: 'https://www.intiman.se',
    address: 'Odengatan 81, 113 22 Stockholm',
  },
  {
    slug: 'gotalejon',
    typ: 'musik',
    name: 'Göta Lejon',
    url: 'https://www.gotalejon.se',
    address: 'Götgatan 55, 116 21 Stockholm',
  },
  {
    slug: 'giljotin',
    typ: 'teater',
    name: 'Teater Giljotin',
    url: 'https://www.teatergiljotin.se',
    address: 'Torsgatan 41, 113 62 Stockholm',
  },
  {
    slug: 'strindbergs',
    typ: 'teater',
    name: 'Strindbergs Intima Teater',
    url: 'https://www.strindbergsintimateater.se',
    address: 'Barnhusgatan 20, 111 23 Stockholm',
  },
  {
    slug: 'liljevalchs',
    typ: 'konst',
    name: 'Liljevalchs konsthall',
    url: 'https://liljevalchs.se',
    address: 'Djurgårdsvägen 60, 115 21 Stockholm',
  },
  {
    slug: 'modernamuseet',
    typ: 'konst',
    name: 'Moderna Museet',
    url: 'https://www.modernamuseet.se',
    address: 'Exercisplan 4, 111 49 Stockholm',
  },
  {
    slug: 'fotografiska',
    typ: 'konst',
    name: 'Fotografiska',
    url: 'https://stockholm.fotografiska.com',
    address: 'Stadsgårdshamnen 22, 116 45 Stockholm',
  },
  {
    slug: 'nationalmuseum',
    typ: 'konst',
    name: 'Nationalmuseum',
    url: 'https://www.nationalmuseum.se',
    address: 'Södra Blasieholmshamnen 2, 111 48 Stockholm',
  },
  {
    slug: 'nalen',
    typ: 'musik',
    name: 'Nalen',
    url: 'https://www.nalen.com',
    address: 'Regeringsgatan 74, 111 39 Stockholm',
  },
  {
    slug: 'aviciiarena',
    typ: 'musik',
    name: 'Avicii Arena',
    url: 'https://aviciiarena.se',
    address: 'Globentorget 2, 121 77 Johanneshov',
  },
  {
    slug: 'annexet',
    typ: 'musik',
    name: 'Annexet',
    url: 'https://annexet.se',
    address: 'Globentorget 2, 121 77 Johanneshov',
  },
  {
    slug: 'hovet',
    typ: 'musik',
    name: 'Hovet',
    url: 'https://hovetarena.se',
    address: 'Globentorget 2, 121 77 Johanneshov',
  },
  {
    slug: 'treaarena',
    typ: 'musik',
    name: '3Arena',
    url: 'https://3arena.se',
    address: 'Arenaslingan 14, 121 77 Johanneshov',
  },
  {
    slug: 'strawberryarena',
    typ: 'musik',
    name: 'Strawberry Arena',
    url: 'https://strawberryarena.se',
    address: 'Råsta strandväg 1, 169 79 Solna',
  },
  {
    slug: 'berwaldhallen',
    typ: 'musik',
    name: 'Berwaldhallen',
    url: 'https://www.berwaldhallen.se',
    address: 'Dag Hammarskjölds väg 3, 115 27 Stockholm',
  },
  {
    slug: 'fasching',
    typ: 'musik',
    name: 'Fasching',
    url: 'https://www.fasching.se',
    address: 'Kungsgatan 63, 111 22 Stockholm',
  },
  {
    slug: 'debaser',
    typ: 'musik',
    name: 'Debaser',
    url: 'https://www.debaser.se',
    address: 'Hornstulls strand 4, 117 39 Stockholm',
  },
  {
    slug: 'dansenshus',
    typ: 'opera',
    name: 'Dansens Hus',
    url: 'https://dansenshus.se',
    address: 'Barnhusgatan 12–14, 111 23 Stockholm',
  },
];

/** Huset för en källa, eller null om källan inte har något registrerat hus. */
export function venueBySlug(slug) {
  return VENUES.find((v) => v.slug === slug) ?? null;
}

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
    name: 'Kulturhuset Stadsteatern',
    url: 'https://kulturhusetstadsteatern.se',
    address: 'Sergels torg, 111 57 Stockholm',
  },
  {
    slug: 'dramaten',
    name: 'Dramaten',
    url: 'https://www.dramaten.se',
    address: 'Nybroplan, 111 47 Stockholm',
  },
  {
    slug: 'konserthuset',
    name: 'Konserthuset Stockholm',
    url: 'https://www.konserthuset.se',
    address: 'Hötorget 8, 111 57 Stockholm',
  },
  {
    slug: 'operan',
    name: 'Kungliga Operan',
    url: 'https://www.operan.se',
    address: 'Gustav Adolfs torg 2, 111 52 Stockholm',
  },
  {
    slug: 'sodrateatern',
    name: 'Södra Teatern',
    url: 'https://sodrateatern.com',
    address: 'Mosebacke torg 1–3, 116 46 Stockholm',
  },
  {
    slug: 'folkoperan',
    name: 'Folkoperan',
    url: 'https://folkoperan.se',
    address: 'Hornsgatan 72, 118 21 Stockholm',
  },
  {
    slug: 'chinateatern',
    name: 'China Teatern',
    url: 'https://www.chinateatern.se',
    address: 'Berzelii park 9, 111 47 Stockholm',
  },
  {
    slug: 'oscarsteatern',
    name: 'Oscarsteatern',
    url: 'https://www.oscarsteatern.se',
    address: 'Kungsgatan 63, 111 22 Stockholm',
  },
  {
    slug: 'intiman',
    name: 'Intiman',
    url: 'https://www.intiman.se',
    address: 'Odengatan 81, 113 22 Stockholm',
  },
  {
    slug: 'gotalejon',
    name: 'Göta Lejon',
    url: 'https://www.gotalejon.se',
    address: 'Götgatan 55, 116 21 Stockholm',
  },
  {
    slug: 'giljotin',
    name: 'Teater Giljotin',
    url: 'https://www.teatergiljotin.se',
    address: 'Torsgatan 41, 113 62 Stockholm',
  },
  {
    slug: 'strindbergs',
    name: 'Strindbergs Intima Teater',
    url: 'https://www.strindbergsintimateater.se',
    address: 'Barnhusgatan 20, 111 23 Stockholm',
  },
];

/** Huset för en källa, eller null om källan inte har något registrerat hus. */
export function venueBySlug(slug) {
  return VENUES.find((v) => v.slug === slug) ?? null;
}

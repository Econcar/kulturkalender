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
];

/** Huset för en källa, eller null om källan inte har något registrerat hus. */
export function venueBySlug(slug) {
  return VENUES.find((v) => v.slug === slug) ?? null;
}

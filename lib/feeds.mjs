// Kultursektionernas flöden.
//
// Ligger här och inte i skannern, för att två ställen läser dem: den nattliga
// insamlingen som observerar, och Pages Functionen som matchar direkt vid
// förfrågan. En lista på två ställen glider isär, och då visar sidan något
// annat än insamlingen mätte.
//
// Undersökta 2026-09-20. DN saknas för att de inte har någon öppen kulturfeed -
// /kultur/rss/ svarar 404. Expressen är med trots att deras slugar inte bär
// ordet recension: deras poster kommer in och matchar sällan, vilket är ett
// resultat värt att kunna se snarare än att anta.
//
// Håll filen fri från Node-API:er. Den körs av node --test, av skannern och på
// Workers.

export const FLÖDEN = [
  ['aftonbladet', 'https://rss.aftonbladet.se/rss2/small/pages/sections/kultur/'],
  ['svd', 'https://www.svd.se/feed/articles.rss'],
  ['svt', 'https://www.svt.se/rss.xml'],
  ['expressen', 'https://feeds.expressen.se/kultur/'],
];

/** Tidningens namn som det ska stå på sidan. */
export const PUBLICISTER = {
  aftonbladet: 'Aftonbladet',
  svd: 'SvD',
  svt: 'SVT',
  expressen: 'Expressen',
  dn: 'DN',
};

export function publicistNamn(nyckel) {
  return PUBLICISTER[nyckel] ?? nyckel ?? null;
}

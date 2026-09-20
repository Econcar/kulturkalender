// RSS och Atom till en lista av poster.
//
// Fjärde gången det här projektet läser andras strukturerade data, och samma
// hållning som lib/ldjson.mjs: läs det som finns, kasta inte på det som saknas.
// Ett flöde med en trasig post ska ge de andra posterna, inte ett undantag.
//
// Ingen XML-parser. Node har ingen inbyggd, projektet har inga beroenden, och
// ett flöde är platt: poster med ett fåtal fält, inga attribut som betyder
// något, ingen namnrymd att hålla reda på. Att plocka ut dem med uttryck är
// ärligare än att dra in en parser för fyra fält - och det är samma avvägning
// som gjordes för mikrodatan hos Konserthuset.
//
// Håll filen fri från Node-API:er. Den körs av node --test och av skannern.

import { clean } from './text.mjs';

/**
 * Posterna i ett flöde.
 *
 * Klarar både RSS (item, pubDate) och Atom (entry, updated, link href), för
 * att fyra kultursektioner inte har enats om vilket de använder.
 */
export function parseFeed(xml) {
  const text = String(xml ?? '');
  const poster = [];

  for (const m of text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const post = parseItem(m[2]);
    if (post) poster.push(post);
  }
  return poster;
}

/** En post, eller null om den saknar adress. */
export function parseItem(xml) {
  const text = String(xml ?? '');

  // Atom skriver adressen som attribut, RSS som innehåll. Prova båda.
  const url = clean(taggInnehåll(text, 'link'))
    ?? clean(/<link\b[^>]*\bhref="([^"]+)"/.exec(text)?.[1]);
  if (!url) return null;

  return {
    url: rensaSpårning(url),
    title: clean(taggInnehåll(text, 'title')),
    description: clean(taggInnehåll(text, 'description') ?? taggInnehåll(text, 'summary')),
    published: clean(
      taggInnehåll(text, 'pubDate')
      ?? taggInnehåll(text, 'published')
      ?? taggInnehåll(text, 'updated'),
    ),
    guid: clean(taggInnehåll(text, 'guid') ?? taggInnehåll(text, 'id')) ?? null,
  };
}

/**
 * Innehållet i en tagg, med CDATA skalat bort.
 *
 * CDATA är nödvändigt att hantera: tidningarna lägger rubriker med & och
 * citattecken i dem, och utan avskalningen blir titeln "<![CDATA[Kungen med".
 */
function taggInnehåll(xml, namn) {
  const m = new RegExp(`<${namn}\\b[^>]*>([\\s\\S]*?)</${namn}>`).exec(xml);
  if (!m) return null;
  const inre = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inre);
  return cdata ? cdata[1] : inre;
}

/**
 * Spårningsparametrar bort ur adressen.
 *
 * Flödena hänger på ?utm_medium=rss. Adressen är vår nyckel mot det vi redan
 * sett, och samma artikel får inte räknas som två bara för att en parameter
 * skiljer. Frågedelen bär aldrig något vi behöver här.
 */
export function rensaSpårning(url) {
  const rensad = String(url ?? '').trim();
  const i = rensad.indexOf('?');
  return i === -1 ? rensad : rensad.slice(0, i);
}

// Cinemateket Stockholm (Svenska Filminstitutet), Filmhuset på Gärdet.
//
// Programsidan laddar sin lista med AJAX från /program/ShowMore/, och listvyn
// (listtype=text) har ett block per visning:
//
//   <div class="article-tickets article__border">
//     <a href=".../filmer/?filmId=14124&cityId=1"><span>Girl 6, Spike Lee (35 mm)</span></a>
//     <a href="https://bio.se/biografer/filmhuset/20261003/1400/Victor">Köp biljetter</a>
//     <time>lör 3/10 kl. 14:00</time> ... Filmhuset - Bio Victor
//     <a href=".../filmer/iCal?eventId=…&title=Girl 6&startDate=2026-10-03 14:00:00
//        &endDate=2026-10-03 16:00:00&location=Filmhuset - Bio Victor">
//
// Kalenderlänken bär start, slut och salong i fast form, så tiderna tas
// därifrån. Titeln tas från den synliga länken: svensk titel, regissör och
// format, där kalenderlänken har originaltiteln ("Krajobraz po bitwie" för
// Landskap efter striden) - den hamnar i beskrivningen.
//
// ShowMore?page=N ger allt fram till sida N, inte bara sida N. Ett anrop med
// högt sidnummer ger hela programmet: 115 visningar till och med januari vid
// undersökningen 2026-10-03. Tipset om sidan kom från användaren; affischens
// PDF undersöktes först och gick att läsa, men bara med layouten som karta.

import { fetchText, isAllowedByRobots } from '../../lib/http.mjs';
import { parseDateTime } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://www.filminstitutet.se';
const PROGRAM = `${BAS}/sv/se-och-samtala-om-film/cinemateket-stockholm/program`;
const LISTA = `${PROGRAM}/ShowMore/?eventtype=&listtype=text&page=50`;

export default {
  id: 'cinemateket',
  label: 'Cinemateket',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(`${PROGRAM}/`))) throw new Error('robots.txt tillåter inte programsidan');
    const rader = rowsFromList(await hämta(LISTA));
    log(`  ${rader.length} visningar`);
    return rader;
  },
};

/** Listvyns HTML till en rad per visning. */
export function rowsFromList(html) {
  const ut = [];
  for (const block of String(html ?? '').split('class="article-tickets article__border"').slice(1)) {
    const kal = /iCal\?([^"]+)"/.exec(block)?.[1]?.replace(/&amp;/g, '&');
    if (!kal) continue;
    const q = new URLSearchParams(kal);
    const starts_at = parseDateTime(q.get('startDate'));
    if (!starts_at) continue;
    const ends_at = parseDateTime(q.get('endDate'));

    const synlig = clean(/<span class="underline">([\s\S]*?)<\/span>/.exec(block)?.[1]) ?? clean(q.get('title'));
    if (!synlig) continue;
    const { titel, regi, format } = delaTitel(synlig);
    const original = clean(q.get('title'));
    const film = /href="(\/sv\/se-och-samtala-om-film\/cinemateket-stockholm\/filmer\/\?filmId=\d+[^"]*)"/.exec(block)?.[1]?.replace(/&amp;/g, '&');

    ut.push({
      url: film ? `${BAS}${film}` : `${PROGRAM}/`,
      title: titel,
      description: [
        regi ? `Regi: ${regi}` : null,
        original && original.toLowerCase() !== titel.toLowerCase() ? `Originaltitel: ${original}` : null,
        format,
      ].filter(Boolean).join(' · ') || null,
      image_url: null,
      category: /unga cinemateket/i.test(synlig) ? 'barn' : 'film',
      genre: null,
      venue_raw: clean(q.get('location'))?.replace(/^Filmhuset\s*-\s*/, '') ?? null,
      address: null,
      starts_at,
      ends_at: ends_at && ends_at > starts_at ? ends_at : null,
      premiere_at: null,
      price_min: null,
      price_max: null,
      currency: 'SEK',
      ticket_url: /href="(https:\/\/bio\.se\/[^"]+)"/.exec(block)?.[1] ?? null,
      status: 'scheduled',
      organizer: 'Cinemateket',
      raw: { synlig, kalender: Object.fromEntries(q) },
      external_id: `${q.get('eventId') ?? titel}/${starts_at.slice(0, 16).replace(/[-:T]/g, '')}`,
    });
  }
  return ut;
}

/**
 * "Girl 6, Spike Lee (35 mm)" → titel, regissör, format.
 *
 * Titeln är det före första kommatecknet; resten är regissörer. "Histoire(s)
 * du cinéma 2a & Orphée, Godard, Cocteau" har två.
 */
export function delaTitel(text) {
  const format = /\((\d+\s*mm|digital|DCP)\)\s*$/i.exec(text)?.[1] ?? null;
  const utan = format ? text.replace(/\s*\([^)]*\)\s*$/, '') : text;
  const i = utan.indexOf(', ');
  let titel = (i > 0 ? utan.slice(0, i) : utan).trim();
  let regi = i > 0 ? utan.slice(i + 2).trim() : null;
  // "En farlig kvinna, A.E. Green + Betty flyttar": en film och en kortfilm
  // före. Det efter plustecknet hör till titeln, inte till regissören.
  const plus = regi?.indexOf(' + ') ?? -1;
  if (plus > 0) {
    titel = `${titel} + ${regi.slice(plus + 3).trim()}`;
    regi = regi.slice(0, plus).trim();
  }
  return {
    titel,
    regi,
    format: format ? `Visas på ${format.replace(/\s+/g, ' ')}` : null,
  };
}

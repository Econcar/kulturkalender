import { fail, json, options, supabaseRest } from './_shared.js';
import { FLÖDEN, publicistNamn } from '../../lib/feeds.mjs';
import { parseFeed } from '../../lib/rss.mjs';
import { matchReview, parseReviewUrl } from '../../lib/review-match.mjs';

// Nyhetssidan: vad som är nytt hos scenerna, och vad som skrivits om det.
//
// Två slags nyheter, och bara den ena kräver en ny källa.
//
// Nya uppsättningar kommer ur vår egen data. Skannern sätter first_seen_at en
// gång per rad och rör den aldrig mer, så en uppsättning vars tidigaste rad
// dök upp i går är en uppsättning scenen annonserade i går. Ingen extra
// hämtning, inga pressmeddelanden att tolka.
//
// Recensionerna matchas här och nu, mot flödena, utan att lagras. Det hade
// varit rimligare att spara dem i databasen - men skrivningarna dit är trasiga
// (se scanner/lib/supabase.mjs), och funktionen fungerar ändå: flödena bär
// ändå bara ett par dygn, och svaret cachas en halvtimme. Blir lagring möjlig
// är det en förbättring, inte en förutsättning.
//
// Ändpunkten tar inga parametrar. Det är med flit: en cachenyckel betyder att
// flödena hämtas som mest två gånger i timmen oavsett hur många som besöker
// sidan, och hyfsen mot tidningarna är samma sak som hyfsen mot scenerna.

const CACHE_SEKUNDER = 1800;

// Hur långt bakåt något räknas som nytt. Två veckor är vad en människa menar
// med "har det kommit något nytt?", och det täcker en utebliven nattkörning.
const NYTT_DYGN = 14;

export const onRequestOptions = options;

export async function onRequestGet({ env }) {
  let uppsättningar;
  try {
    // Alla, inte bara de nya: recensionerna matchas mot hela repertoaren.
    uppsättningar = await supabaseRest(env, 'upcoming_productions?select=*&limit=1000');
  } catch (err) {
    return fail(err.message, 502);
  }

  const gräns = Date.now() - NYTT_DYGN * 86_400_000;
  const nya = uppsättningar
    .filter((p) => p.announced_at && new Date(p.announced_at).getTime() >= gräns)
    .sort((a, b) => String(b.announced_at).localeCompare(String(a.announced_at)))
    .slice(0, 40);

  // Recensionerna får falla utan att fälla nyheterna. Att en tidning ligger
  // nere är inget skäl att dölja att Dramaten satt upp något nytt.
  let recensioner = [];
  try {
    recensioner = await hämtaRecensioner(uppsättningar);
  } catch {
    recensioner = [];
  }

  return json({
    generated_at: new Date().toISOString(),
    days: NYTT_DYGN,
    productions: nya,
    reviews: recensioner,
  }, { maxAge: CACHE_SEKUNDER });
}

async function hämtaRecensioner(uppsättningar) {
  const poster = [];

  const svar = await Promise.allSettled(FLÖDEN.map(async ([publicist, url]) => {
    const res = await fetch(url, {
      headers: { 'user-agent': 'kulturkalender/0.1 (+https://github.com/Econcar/kulturkalender)' },
    });
    if (!res.ok) throw new Error(`${publicist} svarade ${res.status}`);
    return [publicist, parseFeed(await res.text())];
  }));

  for (const r of svar) {
    if (r.status !== 'fulfilled') continue;
    const [publicist, flöde] = r.value;
    for (const post of flöde) poster.push({ ...post, publisher: publicist });
  }

  const ut = [];
  for (const post of poster) {
    if (!parseReviewUrl(post.url).isReview) continue;

    const träff = matchReview(post, uppsättningar);
    if (!träff) continue;

    const p = uppsättningar.find((u) => u.production_key === träff.production_key);
    ut.push({
      url: post.url,
      title: post.title,
      // Tidningens egen ingress, inte artikeltexten. "ÅSA LINDERBORG ser en
      // obegripligt svag Parzival på Dramaten" säger vem som skrivit och vad
      // hen tyckte; rubriken säger varken vad eller vem. Brödtexten är
      // kritikerns verk och sparas aldrig - se avsnitt 7b i projektstart.
      description: post.description,
      published: post.published,
      publisher: publicistNamn(post.publisher),
      confidence: träff.confidence,
      production: p
        ? { production_key: p.production_key, title: p.title, venue: p.venue, url: p.url }
        : null,
    });
  }

  return ut.sort((a, b) => nyast(b.published) - nyast(a.published));
}

function nyast(datum) {
  const t = new Date(datum ?? 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

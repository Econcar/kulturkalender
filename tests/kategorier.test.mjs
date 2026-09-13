import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CATEGORIES, category } from '../lib/event.mjs';

// Kategorilistan finns på tre ställen som inte kan importera varandra:
// lib/event.mjs (skannern), functions/api/events.js (Pages Function) och
// public/app.js (webbläsaren, når inte lib/). Testet jämför dem som text.
//
// Felen som annars uppstår är båda tysta: en kategori som saknas i API:ets
// vitlista gör att filtret ignoreras och användaren får allt i stället för
// urvalet, och en som saknas bland knapparna går inte att välja alls.

const rot = join(dirname(fileURLToPath(import.meta.url)), '..');
const läs = (fil) => readFileSync(join(rot, fil), 'utf8');

test('API:ets vitlista täcker alla kategorier', () => {
  const källa = läs('functions/api/events.js');
  const vitlista = /const CATEGORIES = new Set\(\[([\s\S]*?)\]\)/.exec(källa);
  assert.ok(vitlista, 'CATEGORIES hittades inte i functions/api/events.js');

  const funna = [...vitlista[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  assert.deepEqual([...funna].sort(), [...CATEGORIES].sort());
});

test('varje kategori går att välja i gränssnittet', () => {
  const källa = läs('public/app.js');
  const lista = /const KATEGORIER = \[([\s\S]*?)\n\];/.exec(källa);
  assert.ok(lista, 'KATEGORIER hittades inte i public/app.js');

  const funna = [...lista[1].matchAll(/\['([^']*)',/g)].map((m) => m[1]).filter(Boolean);

  for (const kategori of CATEGORIES) {
    assert.ok(funna.includes(kategori), `${kategori} saknar filterknapp i app.js`);
  }
});

test('category() returnerar bara kategorier som finns i listan', () => {
  // Varje genresträng Kulturhuset faktiskt använder, avläst på deras sidor
  // 2026-09-13. "Cirkus" saknades i tabellen från början och hamnade under
  // "övrigt" – det upptäcktes i en torrkörning, inte i testerna, eftersom
  // fixturerna bara innehöll konserter.
  const genrer = [
    'Konserter', 'Teater', 'Bio', 'Utställningar', 'Dans',
    'Litteratur', 'Cirkus', 'Barn & ung', 'Samtal & debatt', 'Film',
  ];

  for (const genre of genrer) {
    const ut = category({ '@type': 'Event', genre });
    assert.ok(CATEGORIES.includes(ut), `genren "${genre}" gav "${ut}" som inte finns i CATEGORIES`);
  }
});

test('scenens namn i keywords får inte avgöra kategorin', () => {
  // Kulturhuset skriver "kulturhuset stadsteatern" i keywords på varenda sida,
  // och "stadsteatern" innehåller "teater". Slogs fälten ihop blev 71 av 126
  // rader teater – inklusive alla utställningar, all dans och all litteratur.
  // Upptäckt först när riktig data låg i data/events.json.
  const utställning = {
    '@type': 'Event',
    genre: 'Utställningar',
    additionalType: 'Utställningar',
    keywords: 'Utställningar, Sergels torg, kulturhuset stadsteatern, Omfamnad',
  };
  assert.equal(category(utställning), 'utställning');

  const dans = {
    '@type': 'Event',
    genre: 'Dans',
    keywords: 'Dans, Sergels torg, kulturhuset stadsteatern, Cullberg',
  };
  assert.equal(category(dans), 'dans');

  const litteratur = {
    '@type': 'Event',
    genre: 'Litteratur',
    keywords: 'Litteratur, kulturhuset stadsteatern, Susanna Alakoski',
  };
  assert.equal(category(litteratur), 'litteratur');
});

test('keywords används bara när genre inte säger något', () => {
  // Fältet är inte värdelöst – det är bara sist i tur och ordning.
  assert.equal(category({ '@type': 'Event', keywords: 'Cirkus, nycirkus' }), 'cirkus');
  assert.equal(category({ '@type': 'Event', genre: 'Höstens program', keywords: 'Dans' }), 'dans');
});

test('Kulturhusets genrer hamnar där en människa skulle lägga dem', () => {
  const förväntat = {
    Konserter: 'konsert',
    Teater: 'teater',
    Bio: 'film',
    Film: 'film',
    Utställningar: 'utställning',
    Dans: 'dans',
    Litteratur: 'litteratur',
    Cirkus: 'cirkus',
    'Barn & ung': 'barn',
    'Samtal & debatt': 'föreläsning',
  };

  for (const [genre, väntat] of Object.entries(förväntat)) {
    assert.equal(category({ '@type': 'Event', genre }), väntat, `genren "${genre}"`);
  }
});

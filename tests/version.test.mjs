import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { VERSION } from '../public/version.js';

const rot = join(dirname(fileURLToPath(import.meta.url)), '..');
const läs = (fil) => readFileSync(join(rot, fil), 'utf8');

test('sw.js cachar under samma version som sidfoten visar', () => {
  // Glider de isär visar sidan en version medan cachen bär en annan, och då
  // säger sidfoten inte längre det den finns till för att säga. Det felet ser
  // dessutom ut som något helt annat: "jag pushade men det kom inte ut".
  const träff = /CACHE_VERSION = '([^']+)'/.exec(läs('public/sw.js'));

  assert.ok(träff, 'CACHE_VERSION hittades inte i sw.js');
  assert.equal(träff[1], VERSION);
});

test('versionen ser ut som en version', () => {
  assert.match(VERSION, /^v\d+$/);
});

test('varje modul sidan importerar ligger i skalet', () => {
  // En modul som saknas i skalet fungerar inte utan nät, och det märks inte
  // förrän någon står i tunnelbanan och sidan är tom.
  const sw = läs('public/sw.js');
  const moduler = new Set();

  for (const m of läs('public/app.js').matchAll(/from '(\/[\w.-]+\.js)'/g)) moduler.add(m[1]);

  assert.ok(moduler.size > 0, 'hittade inga importer att kontrollera');
  for (const modul of moduler) {
    assert.ok(sw.includes(`'${modul}'`), `${modul} importeras men saknas i sw.js SHELL`);
  }
});

test('skalet pekar inte på filer som inte finns', () => {
  // Receptbokens sidor låg kvar i SHELL långt efter att de raderats. Att
  // cache.add() tar en adress i taget gör att ett sådant fel inte syns –
  // installationen lyckas ändå, med ett hål i skalet.
  const sw = läs('public/sw.js');
  const shell = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(shell, 'SHELL hittades inte i sw.js');

  const adresser = [...shell[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const undantag = new Set(['/', '/index.html']); // rutter, inte filnamn

  for (const adress of adresser) {
    if (undantag.has(adress)) continue;
    assert.doesNotThrow(
      () => läs(join('public', adress)),
      `${adress} står i SHELL men finns inte i public/`,
    );
  }
});

test('service workern registreras faktiskt någonstans', () => {
  // Den fanns i ett halvår utan att köras: filen skrevs, testerna vaktade
  // den, README kallade den PWA-skal - men ingenting anropade register().
  // Testerna bevisade att sw.js var konsekvent med sig själv, inte att den
  // användes, och det gjorde felet svårare att se snarare än lättare.
  const app = läs('public/app.js');

  assert.ok(app.includes('serviceWorker'), 'ingen kod registrerar public/sw.js');
  assert.ok(app.includes("register('/sw.js')"), 'registreringen pekar inte på /sw.js');
});

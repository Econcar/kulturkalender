import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { VENUES, venueBySlug } from '../lib/venues.mjs';
import sources from '../scanner/sources/index.mjs';

const rot = join(dirname(fileURLToPath(import.meta.url)), '..');
const läs = (fil) => readFileSync(join(rot, fil), 'utf8');

// Husens slug binder ihop tre ställen: db/schema.sql, lib/venues.mjs och
// adaptrarnas id. Vyerna joinar venues mot events.source, så en slug som inte
// stämmer ger evenemang utan husnamn OCH ett hus som saknas i listan på
// förstasidan. Båda felen är tysta.

test('varje adapter har ett registrerat hus', () => {
  for (const source of sources) {
    assert.ok(
      venueBySlug(source.id),
      `adaptern "${source.id}" saknar rad i lib/venues.mjs – dess evenemang får inget husnamn`,
    );
  }
});

test('varje hus har en adapter', () => {
  const idn = new Set(sources.map((s) => s.id));
  for (const hus of VENUES) {
    assert.ok(
      idn.has(hus.slug),
      `huset "${hus.slug}" har ingen adapter – det skulle visas med noll för alltid`,
    );
  }
});

test('husets namn är adapterns etikett', () => {
  // Står det "Dramaten" i knappen och "Dramaten (stora scenen)" i loggen är
  // det samma hus som heter två saker, och det märks först i ett buggsvar.
  for (const source of sources) {
    assert.equal(venueBySlug(source.id).name, source.label, `etiketten för ${source.id}`);
  }
});

test('lib/venues.mjs och db/schema.sql har samma hus', () => {
  const sql = läs('db/schema.sql');
  const insert = /insert into public\.venues[\s\S]*?on conflict/.exec(sql);
  assert.ok(insert, 'insert-satsen för venues hittades inte i db/schema.sql');

  // Första strängen på varje värderad är slugen: ('kulturhuset', 'Kulturhuset …'
  const iSql = [...insert[0].matchAll(/\(\s*'([a-z0-9-]+)',\s*'([^']+)'/g)]
    .map((m) => ({ slug: m[1], name: m[2] }));

  assert.deepEqual(
    iSql.map((v) => v.slug).sort(),
    VENUES.map((v) => v.slug).sort(),
    'slugarna skiljer sig mellan SQL och JS',
  );

  for (const rad of iSql) {
    assert.equal(venueBySlug(rad.slug).name, rad.name, `namnet för ${rad.slug}`);
  }
});

test('slugen ser ut som schemat kräver', () => {
  // db/schema.sql har check (slug ~ '^[a-z0-9-]+$'). Bryter en rad mot den
  // går inserten inte igenom, och det upptäcks först vid uppsättningen.
  for (const hus of VENUES) {
    assert.match(hus.slug, /^[a-z0-9-]+$/, `slugen "${hus.slug}"`);
    assert.ok(hus.name?.trim(), `huset ${hus.slug} saknar namn`);
    assert.match(hus.url ?? '', /^https:\/\//, `huset ${hus.slug} saknar giltig adress`);
  }
});

test('okänd slug ger null, inte ett kastat fel', () => {
  assert.equal(venueBySlug('finns-inte'), null);
  assert.equal(venueBySlug(undefined), null);
});

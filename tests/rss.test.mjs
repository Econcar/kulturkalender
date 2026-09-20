import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseFeed, parseItem, rensaSpårning } from '../lib/rss.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Tre verkliga poster ur Aftonbladets kulturflöde, hämtade 2026-09-20: en
// teaterrecension, en bokrecension och en vanlig artikel. Fältnamnen orörda.
const FLÖDE = readFileSync(join(here, 'fixtures', 'kulturflode.xml'), 'utf8');

test('ett riktigt flöde läses helt', () => {
  const poster = parseFeed(FLÖDE);

  assert.equal(poster.length, 3);
  assert.ok(poster.every((p) => p.url.startsWith('https://')));
  assert.ok(poster.every((p) => p.title));
  assert.ok(poster.every((p) => p.published));
});

test('spårningsparametrar följer inte med adressen', () => {
  // Flödena hänger på ?utm_medium=rss. Adressen är nyckeln mot det vi redan
  // sett, och samma artikel får inte räknas som två för att en parameter skiljer.
  const [första] = parseFeed(FLÖDE);

  assert.ok(!första.url.includes('utm_'));
  assert.ok(!första.url.includes('?'));
  assert.equal(
    rensaSpårning('https://x.se/a/b?utm_medium=rss&x=1'),
    'https://x.se/a/b',
  );
  assert.equal(rensaSpårning('https://x.se/a/b'), 'https://x.se/a/b');
});

test('ingressen kommer med, för det är den som säger något', () => {
  // "ÅSA LINDERBORG ser en obegripligt svag Parzival på Dramaten" - tidningens
  // egen ingress bär kritikerns namn och omdömet. Rubriken gör det aldrig.
  const p = parseFeed(FLÖDE).find((x) => x.url.includes('parzival'));

  assert.ok(p, 'hittade inte Parzival-posten');
  assert.match(p.description, /LINDERBORG/);
  assert.match(p.title, /jättepungen/);
});

test('CDATA skalas bort', () => {
  // Tidningarna lägger rubriker med & och citattecken i CDATA. Utan
  // avskalningen blir titeln "<![CDATA[Rubriken".
  const post = parseItem(`
    <item>
      <title><![CDATA[Ett "citat" & ett tecken]]></title>
      <link>https://exempel.se/artikel</link>
      <pubDate>Sun, 20 Sep 2026 09:00:00 GMT</pubDate>
    </item>`);

  assert.equal(post.title, 'Ett "citat" & ett tecken');
});

test('Atom läses också', () => {
  // Fyra kultursektioner har inte enats om format. Atom lägger adressen som
  // attribut och kallar posten entry.
  const poster = parseFeed(`
    <feed>
      <entry>
        <title>En rubrik</title>
        <link rel="alternate" href="https://exempel.se/atom-artikel"/>
        <summary>En ingress</summary>
        <updated>2026-09-20T09:00:00Z</updated>
        <id>abc</id>
      </entry>
    </feed>`);

  assert.equal(poster.length, 1);
  assert.equal(poster[0].url, 'https://exempel.se/atom-artikel');
  assert.equal(poster[0].description, 'En ingress');
  assert.equal(poster[0].published, '2026-09-20T09:00:00Z');
});

test('en post utan adress hoppas över i stället för att fälla flödet', () => {
  const poster = parseFeed(`
    <rss><channel>
      <item><title>Utan länk</title></item>
      <item><title>Med länk</title><link>https://exempel.se/b</link></item>
    </channel></rss>`);

  assert.equal(poster.length, 1);
  assert.equal(poster[0].url, 'https://exempel.se/b');
});

test('ett tomt eller trasigt flöde ger tom lista, inte fel', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed(null), []);
  assert.deepEqual(parseFeed('<html><body>inte ett flöde</body></html>'), []);
  assert.equal(parseItem(''), null);
});

test('fält som saknas blir null, inte tomma strängar', () => {
  const post = parseItem('<item><link>https://exempel.se/c</link></item>');

  assert.equal(post.title, null);
  assert.equal(post.description, null);
  assert.equal(post.published, null);
  assert.equal(post.guid, null);
});

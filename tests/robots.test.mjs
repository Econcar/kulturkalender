// robots.txt enligt RFC 9309. Att respektera den är en princip i projektet,
// så tolkningen ska hellre säga nej en gång för mycket än ja.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HttpError, isAllowedByRobots, robotsTillåter } from '../lib/http.mjs';

test('rakt Disallow och Allow, längsta regeln vinner', () => {
  const txt = 'User-agent: *\nDisallow: /program/\nAllow: /program/oppet/';
  assert.equal(robotsTillåter(txt, '/program/x'), false);
  assert.equal(robotsTillåter(txt, '/program/oppet/y'), true);
  assert.equal(robotsTillåter(txt, '/om-oss'), true);
});

test('* i mitten och $ på slutet', () => {
  const txt = 'User-agent: *\nDisallow: /*?filter=\nDisallow: /*.pdf$';
  assert.equal(robotsTillåter(txt, '/kalender?filter=jazz'), false);
  assert.equal(robotsTillåter(txt, '/kalender?page=2'), true);
  assert.equal(robotsTillåter(txt, '/affisch.pdf'), false);
  assert.equal(robotsTillåter(txt, '/affisch.pdf?v=2'), true);
});

test('flera User-agent i följd delar på reglerna', () => {
  // Den förra tolkningen tappade *-gruppen här: Googlebot-raden sist slog av den.
  const txt = 'User-agent: *\nUser-agent: Googlebot\nDisallow: /api/';
  assert.equal(robotsTillåter(txt, '/api/events'), false);
});

test('en grupp som namnger oss gäller i stället för *-gruppen', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: kulturkalender\nAllow: /program/\nDisallow: /';
  assert.equal(robotsTillåter(txt, '/program/x'), true);
  assert.equal(robotsTillåter(txt, '/annat'), false);
  // Andra robotars grupper rör oss inte.
  assert.equal(robotsTillåter('User-agent: GPTBot\nDisallow: /', '/x'), true);
});

test('Allow vinner vid lika lång regel, tomt Disallow spärrar ingenting', () => {
  assert.equal(robotsTillåter('User-agent: *\nDisallow: /a\nAllow: /a', '/a'), true);
  assert.equal(robotsTillåter('User-agent: *\nDisallow:', '/x'), true);
});

test('procentkodade och okodade sökvägar jämförs lika', () => {
  const txt = 'User-agent: *\nDisallow: /på-annan-plats/';
  assert.equal(robotsTillåter(txt, '/p%C3%A5-annan-plats/x'), false);
});

test('kommentarer och skiftläge i nycklarna', () => {
  const txt = '# hej\nUSER-AGENT: * # alla\ndisallow: /hemligt # nej';
  assert.equal(robotsTillåter(txt, '/hemligt/x'), false);
});

// --- Hämtningen ---------------------------------------------------------------

const svar = (text) => async () => new Response(text, { status: 200 });
const fel = (status) => async (url) => { throw new HttpError(status, url, ''); };

test('ingen robots.txt (404) betyder att allt är tillåtet', async () => {
  assert.equal(await isAllowedByRobots('https://a-404.example/x', { hämta: fel(404) }), true);
});

test('serverfel betyder att vi inte vet, och då hämtas inget', async () => {
  await assert.rejects(
    () => isAllowedByRobots('https://a-503.example/x', { hämta: fel(503) }),
    /robots\.txt för https:\/\/a-503\.example gick inte att läsa .*hämtar inget/,
  );
  await assert.rejects(() => isAllowedByRobots('https://a-429.example/x', { hämta: fel(429) }), /hämtar inget/);
});

test('filen hämtas en gång per sajt, men ett fel sparas inte', async () => {
  let n = 0;
  const räknande = async () => { n += 1; return new Response('User-agent: *\nDisallow: /nej', { status: 200 }); };
  assert.equal(await isAllowedByRobots('https://en-gang.example/ja', { hämta: räknande }), true);
  assert.equal(await isAllowedByRobots('https://en-gang.example/nej', { hämta: räknande }), false);
  assert.equal(n, 1);

  await assert.rejects(() => isAllowedByRobots('https://forsok.example/x', { hämta: fel(500) }));
  assert.equal(await isAllowedByRobots('https://forsok.example/x', { hämta: svar('') }), true);
});

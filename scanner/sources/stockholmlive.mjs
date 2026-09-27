// Stockholm Lives arenor: Avicii Arena, Annexet, Hovet, 3Arena och
// Strawberry Arena.
//
// Samma ägare och samma WordPress-tema som Södra Teatern - varje evenemang har
// ld+json, "Datum & tider" och en faktaruta med scenen, och sidorna tolkas med
// sodrateatern.mjs. Skillnaden är listan. Arenornas egna API:er bär gamla
// evenemang (Avicii Arena 233 poster), men stockholmlive.com/evenemang/ listar
// bara det kommande, för alla arenor på en gång (posts_per_page -1, filtrerat
// på last_showing_end_date). Länkarna går till arenans egen domän, så arenan
// syns redan i adressen.
//
// Listan hämtas en gång per körning och delas av arenorna. Undantagna:
//   - sodrateatern.com - redan en egen källa, och hade gett dubbletter
//   - sport - fotboll och hockey är inte vad kalendern handlar om
//
// Hovet, 3Arena och Strawberry Arena har bara ett fåtal konserter och kan ha
// noll en vanlig vecka. De markeras kanVaraTom, så att en tom natt inte larmar.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { eventsFromPage } from './sodrateatern.mjs';

const LISTA = 'https://www.stockholmlive.com/evenemang/';

let delad = null;

/** Listans evenemangsadresser per värd. Hämtas en gång per process. */
async function lista(hämta) {
  delad ??= (async () => {
    const html = await hämta(LISTA);
    return eventUrls(html);
  })().catch((err) => {
    delad = null;
    throw err;
  });
  return delad;
}

/** Nollställer den delade listan - för testerna. */
export function glöm() {
  delad = null;
}

/** Adresserna i listan: https://<arena>/evenemang/<kategori>/<slug>/. */
export function eventUrls(html) {
  const ut = new Set();
  for (const m of String(html ?? '').matchAll(/href="(https:\/\/[a-z0-9.-]+\/evenemang\/([a-z-]+)\/[a-z0-9-]+\/)"/g)) {
    if (m[2] === 'sport') continue;
    ut.add(m[1]);
  }
  return [...ut];
}

export function arenaKälla({ id, label, värd, kanVaraTom = false }) {
  return {
    id,
    label,
    enabled: true,
    kanVaraTom,

    async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
      if (!(await robotsOk(`https://${värd}/evenemang/`))) throw new Error('robots.txt tillåter inte hämtning');

      const adresser = (await lista(hämta)).filter((u) => new URL(u).hostname === värd);
      log(`  ${adresser.length} evenemang i Stockholm Lives lista`);

      const ut = [];
      for (const url of adresser) {
        await paus(1200);
        try {
          ut.push(...eventsFromPage(await hämta(url), url));
        } catch (err) {
          log(`  hoppar över ${url}: ${err.message}`);
        }
      }
      return ut;
    },
  };
}

export default [
  arenaKälla({ id: 'aviciiarena', label: 'Avicii Arena', värd: 'aviciiarena.se' }),
  arenaKälla({ id: 'annexet', label: 'Annexet', värd: 'annexet.se' }),
  arenaKälla({ id: 'hovet', label: 'Hovet', värd: 'hovetarena.se', kanVaraTom: true }),
  arenaKälla({ id: 'treaarena', label: '3Arena', värd: '3arena.se', kanVaraTom: true }),
  arenaKälla({ id: 'strawberryarena', label: 'Strawberry Arena', värd: 'strawberryarena.se', kanVaraTom: true }),
];

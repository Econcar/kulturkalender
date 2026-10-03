// Artipelag (och Bonniers Konsthall, se nedan).
//
// Ingen av dem har maskinläsbar data eller datum i sitt WordPress-API (fälten
// är tomma utåt), men båda har en lista som länkar till utställningarna och
// ett datumspann i klartext på varje utställningssida. Undersökta 2026-10-03.
// Tolkningen är gemensam: scanner/lib/utstallning.mjs.
//
// Magasin III undersöktes samtidigt och valdes bort: senaste utställningen i
// deras API är från 2022.
//
// Bonniers Konsthall byggdes och togs bort samma dag. Sajten svarade
// hemifrån men 403 till GitHub Actions - den spärrar molnets adresser. Det
// respekteras; att ta sig förbi en spärr är inte att läsa det en sajt
// publicerar. Fabriken nedan bär den gärna om spärren hävs:
//   lista: 'https://bonnierskonsthall.se/utstallningar/'
//   länk:  /utstallning/<slug>/, datum som "26 aug → 8 nov 2026".

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { utställningsrad } from '../lib/utstallning.mjs';

/** En konsthall som listar sina utställningar på en sida. */
export function konsthall({ id, label, lista, länk, titelSuffix, kanVaraTom = false }) {
  return {
    id,
    label,
    enabled: true,
    kanVaraTom,

    async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
      if (!(await robotsOk(lista))) throw new Error('robots.txt tillåter inte hämtning');

      const adresser = utställningsadresser(await hämta(lista), länk);
      log(`  ${adresser.length} utställningssidor`);

      const ut = [];
      for (const url of adresser) {
        await paus(1200);
        try {
          const rad = utställningsrad(await hämta(url), url, { organizer: label, titelSuffix });
          // Listan kan bära det som just stängt; det som har slutat tas inte med.
          if (rad && new Date(rad.ends_at) >= now) ut.push(rad);
        } catch (err) {
          log(`  hoppar över ${url}: ${err.message}`);
        }
      }
      return ut;
    },
  };
}

/** Utställningsadresserna i listan, var och en en gång. */
export function utställningsadresser(html, länk) {
  return [...new Set([...String(html ?? '').matchAll(länk)].map((m) => m[1]))];
}

export default [
  konsthall({
    id: 'artipelag',
    label: 'Artipelag',
    lista: 'https://artipelag.se/pa-gang/utstallning/',
    länk: /href="(https:\/\/artipelag\.se\/pa-gang\/utstallning\/[a-z0-9-]+\/)"/g,
    titelSuffix: /\s*[-–|]\s*Artipelag$/,
    kanVaraTom: true,
  }),
];

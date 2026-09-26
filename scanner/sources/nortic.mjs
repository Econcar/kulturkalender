// Nortic: Teater Giljotin och Strindbergs Intima Teater.
//
// Båda teatrarna säljer biljetter genom Nortic, och Nortics evenemangssidor
// (www.nortic.se/ticket/event/85550) bär ld+json med ett Event per
// föreställning - nivå 1, lib/event.mjs läser dem rakt av. Arrangörssidan hos
// Nortic ritas däremot i webbläsaren och har inga länkar, så föreställningarna
// hittas via teatrarnas egna sajter, som länkar till sina Nortic-evenemang.
//
// Tre saker i Nortics block som måste rättas, alla sedda 2026-09-26:
//  - endDate är bara ett datum, "2026-10-07", och tolkas som midnatt - alltså
//    FÖRE en föreställning klockan 19. Databasen avvisar en sådan rad
//    (events_slutar_efter_start), och hela källans skrivning hade fallit.
//  - image är två adresser ihopklistrade: "https://tickets.nortic.sehttps://
//    branding.nortic.io/…". Den sista är den riktiga.
//  - description börjar med genren i hakparentes: "[Teater] Agent 08".
//
// Giljotins egen kalender ritas från Squarespaces ?format=json, som deras
// robots.txt stänger. Den används inte.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { category as kategoriUrNod, eventNodes, toEvent } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const NORTIC = 'https://www.nortic.se/ticket/event';

/**
 * En källa för en teater som säljer genom Nortic.
 *
 *   sidor(startsida) → vilka av teaterns egna sidor som ska läsas för länkar
 *   plats            → föreställningar på andra scener (gästspel) sorteras bort
 */
export function norticKälla({ id, label, bas, sidor = () => [], plats }) {
  return {
    id,
    label,
    enabled: true,

    async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
      if (!(await robotsOk(`${bas}/`)) || !(await robotsOk(`${NORTIC}/1`))) {
        throw new Error('robots.txt tillåter inte hämtningen');
      }

      const start = await hämta(`${bas}/`);
      const idn = new Set(norticIds(start));
      for (const url of sidor(start)) {
        await paus(1200);
        try {
          for (const n of norticIds(await hämta(url))) idn.add(n);
        } catch (err) {
          log(`  hoppar över ${url}: ${err.message}`);
        }
      }
      log(`  ${idn.size} evenemang hos Nortic`);
      if (!idn.size) throw new Error('inga Nortic-länkar på teaterns sidor - formatet kan ha ändrats');

      const ut = [];
      for (const n of idn) {
        await paus(1200);
        let html;
        try {
          html = await hämta(`${NORTIC}/${n}`);
        } catch (err) {
          log(`  hoppar över evenemang ${n}: ${err.message}`);
          continue;
        }
        ut.push(...eventsFromNortic(html, n, plats));
      }
      log(`  ${ut.length} föreställningar`);
      return ut;
    },
  };
}

export default [
  norticKälla({
    id: 'giljotin',
    label: 'Teater Giljotin',
    bas: 'https://www.teatergiljotin.se',
    plats: /giljotin/i,
    // Varje uppsättning har en egen sida med sin Nortic-länk. Menyn länkar
    // till dem, men också till arkiv, kontakt och annat som inte är program.
    // "new-page-5" och liknande är Squarespaces standardnamn och står kvar på
    // flera uppsättningar, så de får vara med.
    sidor: (html) => egnaSidor(html, 'https://www.teatergiljotin.se',
      /^\/(\d|arkiv|om|kontakt|press|hyr|cart|biljett|kalender|aktuellt|account|search|trailers)/),
  }),
  norticKälla({
    id: 'strindbergs',
    label: 'Strindbergs Intima Teater',
    bas: 'https://www.strindbergsintimateater.se',
    plats: /strindberg|intima/i,
    // Startsidan länkar till allt som spelas; de andra sidorna är arkiv och
    // information.
    sidor: () => [],
  }),
];

/** Nortics evenemangsid på en sida, oavsett om länken går till www eller tickets. */
export function norticIds(html) {
  return [...new Set([...String(html ?? '').matchAll(/nortic\.se\/ticket\/event\/(\d+)/g)].map((m) => m[1]))];
}

/** Teaterns egna sidor med ett led i adressen, utom de som matchar bort. */
export function egnaSidor(html, bas, bort) {
  const ut = new Set();
  for (const m of String(html ?? '').matchAll(/href="(\/[a-z0-9-]+)"/g)) {
    if (!bort.test(m[1])) ut.add(`${bas}${m[1]}`);
  }
  return [...ut];
}

/** En Nortic-sida till rader, en per föreställning, rättade enligt ovan. */
export function eventsFromNortic(html, norticId, plats = /./) {
  const ut = [];
  for (const nod of eventNodes(html)) {
    const platsnamn = clean(nod?.location?.name) ?? '';
    if (plats && !plats.test(platsnamn)) continue;

    const genre = /^\s*\[([^\]]+)\]/.exec(String(nod.description ?? ''))?.[1] ?? null;
    const rättad = {
      ...nod,
      description: clean(String(nod.description ?? '').replace(/^\s*\[[^\]]+\]\s*/, '')),
      image: bild(nod.image),
      genre: genre ?? nod.genre,
    };
    const rad = toEvent(rättad, { sourceUrl: `${NORTIC}/${norticId}` });
    if (!rad) continue;

    if (rad.ends_at && rad.ends_at < rad.starts_at) rad.ends_at = null;
    rad.category = kategoriUrNod(rättad);
    // Beskrivningen är ofta bara titeln en gång till.
    if (rad.description && rad.description.toLowerCase() === rad.title.toLowerCase()) rad.description = null;
    rad.venue_raw = null;
    rad.external_id = `${norticId}/${rad.starts_at.slice(0, 16).replace(/[-:T]/g, '')}`;
    ut.push(rad);
  }
  return ut;
}

/** Den sista https-adressen i fältet - se kommentaren högst upp. */
function bild(värde) {
  const text = String([].concat(värde ?? [])[0] ?? '');
  const i = text.lastIndexOf('https://');
  return i >= 0 ? text.slice(i) : null;
}

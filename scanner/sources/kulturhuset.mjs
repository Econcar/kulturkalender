// Kulturhuset Stadsteatern.
//
// Nivå 1 enligt scanner/sources/_template.mjs: sajten publicerar fullständig
// ld+json @type: Event på varje evenemangssida, så lib/event.mjs läser noden
// rakt av och adaptern behöver bara hitta adresserna.
//
// Adresserna tas från kategorisidorna, inte från sitemap.xml. Sitemapen har
// 980 adresser men är till stor del arkiv: gamla uppsättningar ligger kvar med
// "startDate": null och skulle kosta 980 hämtningar för ett hundratal
// aktuella rader. Kategorisidorna är sajtens egen bild av vad som spelas nu,
// de är serverrenderade, och de paginerar inte.
//
// Känt: en pjäs som spelas i två månader publiceras som EN Event med startDate
// på premiären och endDate på derniären. Vi får alltså speltiden, inte de
// enskilda föreställningarna. Konserter är däremot ett kvällsdatum. Det är
// sajtens modell och inte vår – se avsnitt 10 i docs/projektstart.md.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { eventsFromHtml, hasEventNode } from '../../lib/event.mjs';

const BAS = 'https://kulturhusetstadsteatern.se';

// Kategorierna som listar evenemang. Sidor som bibliotek, uthyrning och
// for-skolan bär också @type: Event men är verksamhetssidor – de listas inte
// här, och skulle de råka komma med faller de ändå bort på saknad starttid.
const KATEGORIER = [
  'konserter', 'teater', 'bio', 'utstallningar', 'dans',
  'litteratur', 'cirkus', 'samtal-debatt', 'barn-ung', 'film',
];

export default {
  id: 'kulturhuset',
  label: 'Kulturhuset Stadsteatern',
  enabled: true,

  // hämta, paus och robotsOk injiceras av testerna. Standardvärdena är det
  // skarpa läget – ett test som råkar gå ut på nätet är inget test.
  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(`${BAS}/konserter`))) {
      throw new Error('robots.txt tillåter inte hämtning av programsidorna');
    }

    const adresser = await eventUrls({ log, hämta, paus });
    log(`  ${adresser.length} evenemangssidor att hämta`);

    const ut = [];
    let utanBlock = 0;  // inget Event alls – misstänkt formatändring
    let utanDatum = 0;  // Event utan startDate – arkivsida, helt normalt
    let hämtade = 0;

    for (const url of adresser) {
      let html;
      try {
        html = await hämta(url);
      } catch (err) {
        // En enskild sida som strular ska inte fälla hela källan. Loggas och
        // hoppas över; nästa körning försöker igen.
        log(`  hoppar över ${url}: ${err.message}`);
        continue;
      }
      hämtade += 1;

      const events = eventsFromHtml(html, { sourceUrl: url });
      if (!events.length) {
        if (hasEventNode(html)) utanDatum += 1;
        else utanBlock += 1;
      }

      for (const event of events) {
        ut.push({ ...event, external_id: externalId(url) });
      }
      await paus(1200); // var snäll mot källan
    }

    // Bara avsaknaden av själva blocket larmar. Arkivsidor utan datum är
    // väntade och säger ingenting om sajtens format.
    if (hämtade && utanBlock > hämtade * 0.8) {
      throw new Error(`${utanBlock} av ${hämtade} sidor saknade ld+json Event – formatet kan ha ändrats`);
    }
    log(`  ${ut.length} daterade, ${utanDatum} utan datum (arkiv), ${utanBlock} utan block`);

    return ut;
  },
};

/** Adresserna till de enskilda evenemangssidorna, från kategorisidorna. */
export async function eventUrls({ log = () => {}, hämta = fetchText, paus = sleep } = {}) {
  const alla = new Set();

  for (const kategori of KATEGORIER) {
    let html;
    try {
      html = await hämta(`${BAS}/${kategori}`);
    } catch (err) {
      log(`  kategorin ${kategori} gick inte att hämta: ${err.message}`);
      continue;
    }

    const före = alla.size;
    for (const url of extractEventUrls(html, kategori)) alla.add(url);
    log(`  ${kategori}: ${alla.size - före} nya`);
    await paus(1200);
  }

  return [...alla];
}

/**
 * Länkarna till evenemang i en kategori.
 *
 * Bara /<kategori>/<slug> med exakt två led – sajten blandar in adresser som
 * /sergels-torg/biljettinformation och /teater/for-skolan/nagot i samma
 * markup, och de är inte evenemang.
 */
export function extractEventUrls(html, kategori) {
  const mönster = new RegExp(`href="(/${kategori}/[a-z0-9åäö-]+)"`, 'gi');
  const ut = new Set();

  for (const m of String(html ?? '').matchAll(mönster)) {
    ut.add(`${BAS}${m[1]}`);
  }
  return [...ut];
}

/**
 * Slugen är id:t. Den ligger i adressen, ändras inte medan uppsättningen
 * spelas, och är det enda stabila sajten ger – det finns inget numeriskt id
 * i ld+json-blocket.
 */
export function externalId(url) {
  const delar = new URL(url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
  return delar.join('/');
}

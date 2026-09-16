// Mall för en ny källadapter. Kopiera, döp om, registrera i index.mjs.
//
// Regler:
//  - Returnera rader i event.mjs form, plus external_id. Adaptern ansvarar för
//    att hitta och tolka, inte för att städa text – det gör lib/text.mjs.
//  - external_id måste vara stabilt över tid för samma evenemang. Scenens eget
//    id om det finns, annars URL-slugen. Aldrig radnummer, aldrig titeln.
//  - Kasta hellre än att returnera skräp – run.mjs loggar och går vidare till
//    nästa källa. En trasig källa ska aldrig fälla hela jobbet.
//  - Respektera robots.txt och håll takten låg. Se avsnitt 9 i
//    docs/projektstart.md.
//
// Källorna är olika, och det är den bärande insikten i hela bygget. Tre nivåer,
// alla tre verifierade mot riktiga sidor i september 2026:
//
//   1. ld+json @type: Event  – Kulturhuset Stadsteatern. Bäst: lib/event.mjs
//      läser noden rakt av och adaptern behöver bara hitta adresserna.
//   2. Inbäddad JSON         – Dramaten lägger hela sidan i __NEXT_DATA__, med
//      ett performances[] som är rikare än deras ld+json hade varit. Egen
//      tolkning, men JSON och inte HTML.
//   3. og:-taggar + URL      – sista utvägen. Titel, tid, bild och länk, inte
//      mer. Konserthusets detaljsidor ser ut så här.
//
// Börja alltid med att leta efter nivå 1. Faller den bort är nivå 3 sista
// utvägen, och då ska adaptern säga vad den inte kan få fram i stället för att
// gissa.
//
//   4. Eget JSON-API           – Kungliga Operan. Sidorna bär ingenting alls,
//      men webapi.operan.se svarar med speltillfällen i ren JSON. Adressen
//      stod i en chunk som huvudbunten importerar, inte i bunten själv.
//
// Men leta på rätt sida först. Konserthuset bokfördes som nivå 3 därför att
// undersökningen läste en evenemangssida. Husets *kalender* är märkt med
// mikrodata och bär både pris och sluttid, och knappen "Visa fler" är en
// JSON-ändpunkt som ger hela programmet i sex anrop. Listsidan och detaljsidan
// kan vara olika nivåer, och den rikare av dem är den som räknas.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { eventsFromHtml } from '../../lib/event.mjs';

const LIST_URL = 'https://example.se/program';

export default {
  id: 'template',
  label: 'Mall (inaktiv)',
  enabled: false,

  async fetchEvents({ log = console.log } = {}) {
    if (!(await isAllowedByRobots(LIST_URL))) {
      throw new Error('robots.txt tillåter inte hämtning av den här sökvägen');
    }

    const adresser = await eventUrls(LIST_URL);
    log(`  ${adresser.length} evenemangssidor att hämta`);

    const out = [];
    for (const url of adresser) {
      const html = await fetchText(url);
      for (const event of eventsFromHtml(html, { sourceUrl: url })) {
        out.push({ ...event, external_id: externalId(url) });
      }
      await sleep(1500); // var snäll mot källan
    }
    return out;
  },
};

/** Adresserna till de enskilda evenemangssidorna. */
async function eventUrls(listUrl) {
  const html = await fetchText(listUrl);
  const träffar = html.matchAll(/href="(\/program\/[^"#?]+)"/g);
  return [...new Set([...träffar].map((m) => new URL(m[1], listUrl).href))];
}

/** Slugen är stabil så länge sidan finns kvar på samma adress. */
function externalId(url) {
  return new URL(url).pathname.replace(/\/$/, '').split('/').pop();
}

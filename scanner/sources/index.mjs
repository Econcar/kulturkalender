// Register över datakällor. En adapter per scen, alla med samma kontrakt:
//
//   export default {
//     id: 'kortnamn',            // används i events.source och scan_runs.source
//     label: 'Visningsnamn',
//     enabled: true,
//     async fetchEvents(ctx) { return [ /* rader, se _template.mjs */ ]; }
//   }
//
// fetchEvents får kasta – run.mjs fångar per källa så en trasig källa aldrig
// fäller hela jobbet.
//
// Ordningen att bygga dem, från undersökningen i docs/projektstart.md avsnitt 4:
//   'kulturhuset'  – ld+json @type: Event, komplett. Byggd.
//   'dramaten'     – __NEXT_DATA__ med performances[]. Byggd, och den bevisade
//                    poängen: adaptermönstret bär en källa utan ld+json, och
//                    ger dessutom enskilda föreställningar i stället för hela
//                    speltider.
//   'konserthuset' – utpekad som den tunnaste av de tre, men visade sig vara
//                    den rikaste: kalendern är märkt med mikrodata och bär
//                    både pris och sluttid, vilket varken Kulturhuset eller
//                    Dramaten ger. Undersökningen hade tittat på detaljsidan,
//                    inte på listan. Byggd.

//   'operan'       – bokfördes som omöjlig: sidorna bär varken ld+json,
//                    mikrodata eller datum. Datan ligger i ett eget JSON-API
//                    på webapi.operan.se, som bara refereras från en chunk
//                    huvudbunten importerar. Byggd, och den renaste källan av
//                    alla fyra.
//   'sodrateatern' – ld+json på varje sida, men startDate är dörrtiden. Tiden
//                    tas ur sidans "Datum & tider". Byggd 2026-09-26.
//   'folkoperan'   – ingen maskinläsbar data, men /kop-biljetter/ listar hela
//                    programmet i ett anrop. Byggd 2026-09-26.
//
// Undersökta och bortvalda 2026-09-26: Playhouse Teater och Orionteatern har
// sina datum bara hos Tickster, vars robots.txt stänger allt.
//
// Andra omgången teatrar, samma dag:
//   showtic.mjs    – China Teatern, Oscarsteatern och Intiman. Biljettsajtens
//                    öppna JSON-API, samma som dess knapp "Visa fler" anropar.
//   'gotalejon'    – Live Nation. Evenemangen som JSON i React Server
//                    Components-strömmen, en artistsida i taget.
//   nortic.mjs     – Teater Giljotin och Strindbergs Intima. ld+json per
//                    föreställning hos Nortic, länkarna från teatrarnas sajter.
// Maximteatern har ingen sajt att läsa: .se är parkerad, .com en casinosida.

import kulturhuset from './kulturhuset.mjs';
import dramaten from './dramaten.mjs';
import konserthuset from './konserthuset.mjs';
import operan from './operan.mjs';
import sodrateatern from './sodrateatern.mjs';
import folkoperan from './folkoperan.mjs';
import showtic from './showtic.mjs';
import gotalejon from './gotalejon.mjs';
import nortic from './nortic.mjs';

const sources = [
  kulturhuset, dramaten, konserthuset, operan, sodrateatern, folkoperan,
  ...showtic, gotalejon, ...nortic,
];

export default sources;

export function selectSources(filter) {
  const active = sources.filter((source) => source.enabled !== false);
  if (!filter) return active;
  const wanted = new Set(String(filter).split(',').map((s) => s.trim()).filter(Boolean));
  return active.filter((source) => wanted.has(source.id));
}

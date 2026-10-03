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
//
// Konst, 2026-09-27. Utställningar pågår i månader, och det krävde att vyn
// räknar det som har börjat men inte slutat - se upcoming_events.
//   'liljevalchs'    – The Events Calendars öppna REST-API.
//   'modernamuseet'  – WordPress-API:et, filtrerat på Stockholm och svenska.
//   'fotografiska'   – ld+json ExhibitionEvent på varje utställningssida.
//   'nationalmuseum' – datumspannet i sidhuvudets text. Utan /på-annan-plats/.
//
// Musik, 2026-09-27.
//   'nalen'          – Storyblok-data på startsidan; scentiden från konsertsidan,
//                      eftersom kortets tid är dörrtiden.
//   stockholmlive.mjs – Avicii Arena, Annexet, Hovet, 3Arena, Strawberry Arena.
//                      Stockholm Lives lista över det kommande, sidorna tolkade
//                      med sodrateatern.mjs. Utan Södra Teatern och sport.
//   'berwaldhallen'  – kalenderns inbäddade data; EventSeries per konsert.
//   'fasching'       – WordPress-inlägg med datumet i adressen, tiden i text.
//   'debaser'        – startsidans länkar och evenemangssidornas faktaruta.
// Cirkus visar en säkerhetskontroll för robotar (Vercel) och läses inte.
//   'dansenshus'     – WordPress-posttypen dh_event, en rad per show_datetime.
//
// Mer konst, 2026-10-03.
//   konsthallar.mjs  – Bonniers Konsthall och Artipelag: en lista och ett
//                      datumspann i klartext per utställning.
//   'konstakademien' – EventON, ld+json Event per evenemang.
// Magasin III valdes bort: senaste utställningen i deras API är från 2022.

import kulturhuset from './kulturhuset.mjs';
import dramaten from './dramaten.mjs';
import konserthuset from './konserthuset.mjs';
import operan from './operan.mjs';
import sodrateatern from './sodrateatern.mjs';
import folkoperan from './folkoperan.mjs';
import showtic from './showtic.mjs';
import gotalejon from './gotalejon.mjs';
import nortic from './nortic.mjs';
import liljevalchs from './liljevalchs.mjs';
import modernamuseet from './modernamuseet.mjs';
import fotografiska from './fotografiska.mjs';
import nationalmuseum from './nationalmuseum.mjs';
import nalen from './nalen.mjs';
import stockholmlive from './stockholmlive.mjs';
import berwaldhallen from './berwaldhallen.mjs';
import fasching from './fasching.mjs';
import debaser from './debaser.mjs';
import dansenshus from './dansenshus.mjs';
import konsthallar from './konsthallar.mjs';
import konstakademien from './konstakademien.mjs';

const sources = [
  kulturhuset, dramaten, konserthuset, operan, sodrateatern, folkoperan,
  ...showtic, gotalejon, ...nortic,
  liljevalchs, modernamuseet, fotografiska, nationalmuseum,
  nalen, ...stockholmlive, berwaldhallen, fasching, debaser, dansenshus,
  ...konsthallar, konstakademien,
];

export default sources;

export function selectSources(filter) {
  const active = sources.filter((source) => source.enabled !== false);
  if (!filter) return active;
  const wanted = new Set(String(filter).split(',').map((s) => s.trim()).filter(Boolean));
  return active.filter((source) => wanted.has(source.id));
}

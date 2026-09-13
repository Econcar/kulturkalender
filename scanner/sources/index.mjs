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
//   'konserthuset' – og:-taggar och URL-mönster. Den tunnaste av de tre, och
//                    därför den som visar var gränsen går.

import kulturhuset from './kulturhuset.mjs';
import dramaten from './dramaten.mjs';

const sources = [kulturhuset, dramaten];

export default sources;

export function selectSources(filter) {
  const active = sources.filter((source) => source.enabled !== false);
  if (!filter) return active;
  const wanted = new Set(String(filter).split(',').map((s) => s.trim()).filter(Boolean));
  return active.filter((source) => wanted.has(source.id));
}

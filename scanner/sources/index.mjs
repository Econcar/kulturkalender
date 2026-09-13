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
//   'kulturhuset'  – ld+json @type: Event, komplett. Först, för att den bevisar
//                    hela kedjan från hämtning till sida med minst kod.
//   'dramaten'     – __NEXT_DATA__ med performances[]. Bevisar att adapter-
//                    mönstret bär en källa som inte har ld+json alls.
//   'konserthuset' – og:-taggar och URL-mönster. Den tunnaste av de tre, och
//                    därför den som visar var gränsen går.
//
// Ingen av dem är byggd ännu. Fas 1 lägger stommen; adaptrarna är fas 2–4.

const sources = [];

export default sources;

export function selectSources(filter) {
  const active = sources.filter((source) => source.enabled !== false);
  if (!filter) return active;
  const wanted = new Set(String(filter).split(',').map((s) => s.trim()).filter(Boolean));
  return active.filter((source) => wanted.has(source.id));
}

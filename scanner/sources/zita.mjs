// Zita Folkets Bio.
//
// Sajten är en React-app utan något i HTML:en, men appen hämtar sitt program
// från ett öppet JSON-API: /api/get-kalendarium-week.php. Det bär nio dagar
// framåt, dag för dag, och varje film har sina visningar med klockslag, salong
// och biljettlänk:
//
//   week_events: { "2026-10-04": [ { title, genre, runtime, language,
//     directors, images, kinoplex_url,
//     showings: [ { ctime: "12:00:00", screen_name: "3", booking_url } ] } ] }
//
// Nio dagar räcker: skanningen går varje natt, och raderna ligger kvar tills
// de passerat. Undersökt 2026-10-03; robots.txt är tom.

import { fetchText, isAllowedByRobots } from '../../lib/http.mjs';
import { parseDateTime } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';

const BAS = 'https://zita.se';
const API = `${BAS}/api/get-kalendarium-week.php`;

export default {
  id: 'zita',
  label: 'Zita Folkets Bio',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(API))) throw new Error('robots.txt tillåter inte API:et');
    const rader = toRows(JSON.parse(await hämta(API)));
    log(`  ${rader.length} visningar`);
    return rader;
  },
};

/** API-svaret till en rad per visning. */
export function toRows(svar) {
  const ut = [];
  for (const [dag, filmer] of Object.entries(svar?.week_events ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dag)) continue;
    for (const f of filmer ?? []) {
      const title = clean(f?.title);
      if (!title) continue;
      const minuter = Number(f.runtime) || 0;

      for (const v of f.showings ?? []) {
        const klocka = /^(\d{1,2}):(\d{2})/.exec(v?.ctime ?? '');
        if (!klocka) continue;
        const starts_at = parseDateTime(`${dag}T${klocka[1].padStart(2, '0')}:${klocka[2]}`);
        if (!starts_at) continue;

        ut.push({
          url: f.kinoplex_url ? `${BAS}/filmer/${f.kinoplex_url}` : BAS,
          title,
          description: beskrivning(f),
          image_url: f.images?.[0] ?? null,
          // Zita Barnens Bio är barnens program, inte en genre.
          category: /barn/i.test(f.event ?? '') ? 'barn' : 'film',
          genre: clean(f.genre),
          venue_raw: v.screen_name ? `Salong ${v.screen_name}` : null,
          address: null,
          starts_at,
          ends_at: minuter ? new Date(new Date(starts_at).getTime() + minuter * 60_000).toISOString() : null,
          premiere_at: null,
          price_min: null,
          price_max: null,
          currency: 'SEK',
          ticket_url: v.booking_url || null,
          status: 'scheduled',
          organizer: 'Zita Folkets Bio',
          raw: { media_id: f.media_id, event: f.event, ctime: v.ctime, screen: v.screen_name },
          external_id: `${f.media_id ?? f.kinoplex_url}/${starts_at.slice(0, 16).replace(/[-:T]/g, '')}/${v.screen_name ?? ''}`,
        });
      }
    }
  }
  return ut;
}

/** "Regi: … · Frankrike 2026 · Franska, svensk text" och sedan filmens text. */
function beskrivning(f) {
  const fakta = [
    f.directors ? `Regi: ${clean(f.directors)}` : null,
    [clean(f.kinoplex_country), clean(f.kinoplex_year)].filter(Boolean).join(' ') || null,
    [clean(f.language), clean(f.subtitles)].filter(Boolean).join(', ') || null,
  ].filter(Boolean).join(' · ');
  return [fakta, clean(f.description)].filter(Boolean).join('. ') || null;
}

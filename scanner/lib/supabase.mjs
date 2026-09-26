// Supabase-skrivning via PostgREST. Service-nyckeln går förbi RLS och får
// bara finnas i GitHub Actions-secrets – aldrig i frontend eller i repot.
//
// Ärvd från leasingskannern. Att skannern skriver med service-nyckeln medan
// sidan läser med anon-nyckeln är hela säkerhetsmodellen: allmänheten kan läsa
// allt och skriva ingenting. db/rls-test.sql bevisar att det stämmer.

import { fetchWithRetry } from '../../lib/http.mjs';

// Kolumner som Postgres räknar ut själv – att skicka dem ger 400.
const GENERATED_COLUMNS = ['id', 'created_at', 'updated_at', 'first_seen_at'];

export function createClient({ url, serviceKey, dryRun = false } = {}) {
  const base = (url ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  // Flaggan finns vid sidan av miljövariabeln för att `npm run scan:dry` ska
  // fungera likadant på Windows, där npm kör scripten genom cmd och DRY_RUN=1
  // framför kommandot inte är giltig syntax.
  const isDryRun = dryRun || process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');

  if (!isDryRun && (!base || !key)) {
    throw new Error('SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY måste vara satta (eller DRY_RUN=1)');
  }

  async function request(path, { method = 'GET', body, prefer } = {}) {
    const headers = {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (prefer) headers.prefer = prefer;

    const res = await fetchWithRetry(`${base}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // return=minimal ger 201 med tom kropp på POST, inte bara 204. Att tolka
    // den som JSON kastade efter att raderna redan skrivits.
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    dryRun: isDryRun,

    /**
     * Upsert på (source, external_id). Uppdaterar last_seen_at på befintliga
     * rader.
     *
     * last_seen_at är inte bokföring. Ett evenemang som slutar dyka upp hos
     * källan är antingen inställt, slutsålt eller passerat, och de tre är
     * olika saker. Raden raderas därför aldrig av skannern – den slutar bara
     * uppdateras, och sidan får avgöra vad den vill visa.
     */
    async upsertEvents(events) {
      const rows = (events ?? []).map(stripGenerated).map((row) => ({
        ...row,
        last_seen_at: new Date().toISOString(),
      }));
      if (!rows.length) return 0;
      if (isDryRun) {
        console.log(`[dry-run] skulle upserta ${rows.length} rader`);
        return rows.length;
      }

      // Chunkas för att hålla payloaden liten nog för PostgREST.
      let written = 0;
      for (const chunk of chunks(rows, 500)) {
        await request('events?on_conflict=source,external_id', {
          method: 'POST',
          body: chunk,
          prefer: 'resolution=merge-duplicates,return=minimal',
        });
        written += chunk.length;
      }
      return written;
    },

    /**
     * Upsert på url. first_seen_at skickas aldrig och står därför kvar från
     * första gången recensionen sågs; last_seen_at flyttas fram varje natt
     * den fortfarande finns i flödet.
     */
    async upsertReviews(reviews) {
      const rows = (reviews ?? []).map(stripGenerated).map((row) => ({
        ...row,
        last_seen_at: new Date().toISOString(),
      }));
      if (!rows.length) return 0;
      if (isDryRun) {
        console.log(`[dry-run] skulle upserta ${rows.length} recensioner`);
        return rows.length;
      }

      await request('reviews?on_conflict=url', {
        method: 'POST',
        body: rows,
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
      return rows.length;
    },

    /**
     * Startar en rad i scan_runs och returnerar en avslutare.
     *
     * Misslyckas skrivningen fortsätter skanningen ändå. Driftloggen är en
     * anteckning OM arbetet och får aldrig hindra arbetet - det är fel ordning
     * på prioriteringarna, och det kostade sex nattkörningar innan det märktes:
     * Supabases Data API svarade 500 på just den här inserten medan samma rad
     * gick att skriva i SQL-editorn, och hela svepet föll på loggen i stället
     * för att hämta 1100 evenemang.
     *
     * Felet skrivs ut i stället. Det syns i Actions-loggen, och att raden
     * saknas i scan_runs är i sig ett spår.
     */
    async startRun(source) {
      if (isDryRun) {
        return async (result) => console.log(`[dry-run] ${source}:`, result);
      }

      let run = null;
      try {
        [run] = await request('scan_runs', {
          method: 'POST',
          body: [{ source, status: 'running' }],
          prefer: 'return=representation',
        });
      } catch (err) {
        console.log(`  driftloggen kunde inte skrivas (${err.message}) - skannar vidare`);
        return async () => {};
      }

      return async ({ status, rows_found = 0, rows_upserted = 0, error = null }) => {
        try {
          await request(`scan_runs?id=eq.${run.id}`, {
            method: 'PATCH',
            body: { status, rows_found, rows_upserted, error, finished_at: new Date().toISOString() },
            prefer: 'return=minimal',
          });
        } catch (err) {
          console.log(`  driftloggen kunde inte uppdateras: ${err.message}`);
        }
      };
    },
  };
}

export function stripGenerated(row) {
  const copy = { ...row };
  for (const column of GENERATED_COLUMNS) delete copy[column];
  return copy;
}

function* chunks(items, size) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

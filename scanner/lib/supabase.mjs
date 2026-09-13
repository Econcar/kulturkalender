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
    if (res.status === 204) return null;
    return res.json();
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

    /** Startar en rad i scan_runs och returnerar en avslutare. */
    async startRun(source) {
      if (isDryRun) {
        return async (result) => console.log(`[dry-run] ${source}:`, result);
      }
      const [run] = await request('scan_runs', {
        method: 'POST',
        body: [{ source, status: 'running' }],
        prefer: 'return=representation',
      });
      return async ({ status, rows_found = 0, rows_upserted = 0, error = null }) => {
        await request(`scan_runs?id=eq.${run.id}`, {
          method: 'PATCH',
          body: { status, rows_found, rows_upserted, error, finished_at: new Date().toISOString() },
          prefer: 'return=minimal',
        });
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

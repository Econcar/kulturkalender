import test from 'node:test';
import assert from 'node:assert/strict';

import { createClient } from '../scanner/lib/supabase.mjs';

test('ett tomt 201-svar räknas som skrivet, inte som fel', async (t) => {
  // PostgREST svarar 201 utan kropp på POST med return=minimal. Klienten
  // försökte tolka kroppen som JSON och kastade efter att raderna skrivits.
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(null, { status: 201 });

  const db = createClient({ url: 'https://exempel.supabase.co', serviceKey: 'nyckel' });
  const skrivna = await db.upsertEvents([{ source: 'test', external_id: '1', title: 'x' }]);
  assert.equal(skrivna, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { USER_AGENT } from '../lib/http.mjs';

test('user-agenten är ren ASCII', () => {
  // Ett ö i strängen gick fram till scenerna men fick varje skrivning till
  // Supabase att svara 500 - PostgREST avkodar huvudena som UTF-8.
  assert.match(USER_AGENT, /^[\x20-\x7e]+$/);
});

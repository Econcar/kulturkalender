import { fail, json, options, supabaseRest } from './_shared.js';

// Husen sidan hämtar från, med hur mycket som är på gång hos var och en.
// Driver listan högst upp på förstasidan.
//
// Egen endpoint och inte en del av /api/events: listan ändras en gång i
// månaden medan evenemangen ändras varje natt, och den ska kunna cachas
// betydligt längre.

export const onRequestOptions = options;

export async function onRequestGet({ env }) {
  try {
    const venues = await supabaseRest(env, 'venue_summary?select=*&order=name.asc');
    return json({ generated_at: new Date().toISOString(), count: venues.length, venues }, { maxAge: 900 });
  } catch (err) {
    return fail(err.message, 502);
  }
}

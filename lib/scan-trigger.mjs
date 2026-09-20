// Får skanningen startas just nu?
//
// Knappen på sidan startar samma GitHub Actions-jobb som schemat kör, och den
// frågan behöver ett svar som inte ligger i en Pages Function: den här filen
// är ren logik och testbar, funktionen runt den är bara HTTP.
//
// Skälet att det finns en spärr alls är inte vår server - den gör ingenting
// tungt - utan scenernas. Ett svep hämtar ett par hundra sidor från fyra hus.
// Trycker någon femton gånger blir vi det trafikmönster som får en IP
// blockerad, och då slutar kalendern fungera för alla. Hyfsen mot källorna är
// hela projektets förutsättning, se avsnitt 9 i docs/projektstart.md.
//
// Håll filen fri från Node-API:er. Den körs av node --test och på Workers.

/** Minsta tid mellan två svep. Programmen ändras i dagsskala. */
export const COOLDOWN_MINUTER = 10;

/**
 * Om ett nytt svep får startas, och annars varför inte.
 *
 * lastRun är GitHubs senaste körning: { status, createdAt }. status är
 * 'queued', 'in_progress' eller 'completed'.
 */
export function mayTrigger({ lastRun = null, now = new Date(), cooldownMinuter = COOLDOWN_MINUTER } = {}) {
  if (!lastRun) return { ok: true };

  // En körning som redan pågår ska inte dubbleras. Två samtidiga svep hämtar
  // samma sidor två gånger och skriver över varandras rader.
  if (lastRun.status === 'queued' || lastRun.status === 'in_progress') {
    return { ok: false, reason: 'pågår', waitSeconds: 0 };
  }

  const start = new Date(lastRun.createdAt ?? 0).getTime();
  if (!Number.isFinite(start) || Number.isNaN(start)) return { ok: true };

  const gått = (now.getTime() - start) / 1000;
  const spärr = cooldownMinuter * 60;
  if (gått < spärr) {
    return { ok: false, reason: 'för snart', waitSeconds: Math.ceil(spärr - gått) };
  }

  return { ok: true };
}

/**
 * Jämför två hemligheter utan att avslöja var de började skilja sig.
 *
 * En vanlig !== returnerar så fort första tecknet skiljer, och skillnaden i
 * tid går att mäta över nätet. Det är en teoretisk svaghet här - nyckeln
 * skyddar en knapp, inte en databas - men en jämförelse av hemligheter ska
 * vara konstant i tid ändå, för att nästa gång någon kopierar mönstret ska
 * det vara det rätta mönstret som kopieras.
 */
export function secretsEqual(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (!x || !y) return false;
  if (x.length !== y.length) return false;

  let skillnad = 0;
  for (let i = 0; i < x.length; i += 1) {
    skillnad |= x.charCodeAt(i) ^ y.charCodeAt(i);
  }
  return skillnad === 0;
}

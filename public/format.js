// Rena formateringsfunktioner för listan. Inga DOM-anrop, inga nätanrop –
// därför testbara med node --test utan webbläsare. Samma uppdelning som
// receptbokens ingredients.js och scale.js hade.

// Tiderna kommer som UTC från API:et och ska visas som Stockholmstid. Zonen
// sätts uttalat: en besökare som sitter i Berlin ska se när konserten börjar
// i Stockholm, inte när den börjar enligt hens egen klocka.
const ZON = 'Europe/Stockholm';

const DAG = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZON, weekday: 'long', day: 'numeric', month: 'long',
});
const KLOCKAN = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZON, hour: '2-digit', minute: '2-digit',
});
const DATUMNYCKEL = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZON, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** "2026-10-17" i Stockholmstid. Nyckeln som dagsgrupperingen bygger på. */
export function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return DATUMNYCKEL.format(d).replace(/-/g, '-');
}

/** "lördag 17 oktober", med "i dag" och "i morgon" när det stämmer. */
export function dayHeading(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const idag = dayKey(now.toISOString());
  const imorgon = dayKey(new Date(now.getTime() + 86_400_000).toISOString());
  const nyckel = dayKey(iso);

  if (nyckel === idag) return 'I dag';
  if (nyckel === imorgon) return 'I morgon';
  return DAG.format(d);
}

/** "20:00" */
export function time(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : KLOCKAN.format(d);
}

/**
 * Priset som en rad.
 *
 * Gratis skrivs ut, för det är ett säljargument och inte ett saknat värde.
 * Saknas priset skrivs ingenting alls – "0 kr" och "okänt pris" är olika
 * saker, och att blanda ihop dem får någon att stå i dörren utan pengar.
 */
export function price(min, max, currency = 'SEK') {
  if (min === null || min === undefined) return '';
  const enhet = currency === 'SEK' ? 'kr' : currency;
  if (min === 0 && (max === 0 || max === null || max === undefined)) return 'Fri entré';
  if (max === null || max === undefined || max === min) return `${tal(min)} ${enhet}`;
  return `${tal(min)}–${tal(max)} ${enhet}`;
}

function tal(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n));
}

/**
 * Förkortar en beskrivning till ett utdrag.
 *
 * Vi återpublicerar inte arrangörens hela text – se avsnitt 7 i
 * docs/projektstart.md. Kapningen söker en meningsgräns först, för att ett
 * utdrag som slutar mitt i en sats läser sig som ett fel och inte som ett val.
 */
export function utdrag(text, max = 180) {
  const rensad = String(text ?? '').trim();
  if (rensad.length <= max) return rensad;

  const kapad = rensad.slice(0, max);
  const punkt = kapad.lastIndexOf('. ');
  if (punkt > max * 0.5) return kapad.slice(0, punkt + 1);
  const mellanslag = kapad.lastIndexOf(' ');
  return `${kapad.slice(0, mellanslag > 0 ? mellanslag : max)} …`;
}

/**
 * Evenemangen grupperade per dag, i ordning.
 *
 * Listan kommer redan sorterad från API:et, så grupperingen behåller den
 * ordning den fick och sorterar inte om. Sorterar man om här kan sidan visa en
 * annan ordning än API:et lovade, och skillnaden syns bara ibland.
 */
export function groupByDay(events) {
  const dagar = [];
  let aktuell = null;

  for (const event of events ?? []) {
    const nyckel = dayKey(event?.starts_at);
    if (!nyckel) continue;
    if (!aktuell || aktuell.key !== nyckel) {
      aktuell = { key: nyckel, heading: dayHeading(event.starts_at), events: [] };
      dagar.push(aktuell);
    }
    aktuell.events.push(event);
  }
  return dagar;
}

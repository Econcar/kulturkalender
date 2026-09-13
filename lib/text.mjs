// Textstädning för data som hämtas från andras sidor.
//
// Lyft ur receptprojektets lib/recipe.mjs vid pivoten till kulturkalender.
// Funktionerna är rena och domänoberoende – de vet inget om vare sig recept
// eller evenemang – och var redan enhetstestade. Samma resa som ldjson.mjs
// gjorde när leasingskannern blev receptbok.
//
// Håll filen fri från Node-API:er. Den körs av node --test, av skannern, och
// av Cloudflare Pages Functions, som kör på Workers.

// Entiteter som faktiskt dyker upp i det vi hämtar. De typografiska
// citattecknen är inte kuriosa: scenernas beskrivningstexter är satta i
// ordbehandlare och full av &rsquo; och &ndash;. Utan dem står entiteten kvar
// oöversatt mitt i en rubrik.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  auml: 'ä', ouml: 'ö', aring: 'å', Auml: 'Ä', Ouml: 'Ö', Aring: 'Å',
  eacute: 'é', Eacute: 'É', uuml: 'ü', Uuml: 'Ü', szlig: 'ß',
  aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø',
  ndash: '–', mdash: '—', hellip: '…', deg: '°',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·',
  times: '×', divide: '÷', plusmn: '±',
};

/**
 * Avkodar HTML-entiteter i ett svep. Ett svep och inte flera: annars blir
 * "&amp;auml;" – som betyder texten "&auml;" – felaktigt till "ä".
 */
export function decodeEntities(text) {
  return String(text).replace(/&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    // Exakt träff först: &Auml; och &auml; är olika tecken. Gemenerna som
    // fallback fångar skrivsätt som &AMP; och &NBSP;.
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Städar fritext: taggar bort, entiteter tillbaka till tecken, blanksteg
 * ihopdragna. Sajter lägger HTML i ld+json trots att de inte får.
 *
 * Taggarna tas bort före avkodningen, så att ett skrivet "&lt;b&gt;" överlever
 * som texten "<b>" i stället för att bli en tagg som städas bort.
 */
export function clean(value) {
  if (value == null) return null;
  const text = decodeEntities(String(value).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** Allt som ett fält kan vara – ett värde, en array, eller inget – som array. */
export function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Första värdet, oavsett om fältet var en array eller ett ensamt värde. */
export function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

// Läsare för <script type="application/ld+json"> – schema.org-data som sajter
// publicerar för sökmotorer. Kulturhuset Stadsteatern lägger hela evenemanget
// där: namn, tid, plats, pris och biljettlänk.
//
// Tredje domänen som använder filen. Leasingskannern läste @type: Product ur
// den, receptboken @type: Recipe, den här @type: Event – och koden har inte
// ändrats en rad mellan dem, bara den här kommentaren. Att läsa strukturerad
// data sajten själv publicerar är både snällare och långt mindre skört än att
// gissa CSS-selektorer.
//
// Håll den här filen fri från Node-API:er. Den ska kunna köras både av
// node --test och av Cloudflare Pages Functions, som kör på Workers.

const SCRIPT_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Alla ld+json-objekt på sidan, utplattade.
 *
 * Blocken kan se ut på tre sätt, och sajter blandar dem: ett ensamt objekt,
 * en array av objekt, eller ett @graph som samlar flera. Alla tre plattas ut
 * här så att anroparen slipper bry sig.
 */
export function extractAllJsonLd(html) {
  const out = [];
  for (const match of String(html ?? '').matchAll(SCRIPT_RE)) {
    let parsed;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue; // Ett trasigt block ska inte fälla de andra.
    }
    collect(parsed, out);
  }
  return out;
}

function collect(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out);
    return;
  }
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node['@graph'])) collect(node['@graph'], out);
  if (node['@type']) out.push(node);
}

/** Första objektet med angiven @type, eller null. */
export function findByType(html, type) {
  return extractAllJsonLd(html).find((node) => hasType(node, type)) ?? null;
}

/** @type kan vara en sträng eller en array – "Recipe" eller ["Recipe","NewsArticle"]. */
export function hasType(node, type) {
  const raw = node?.['@type'];
  const wanted = String(type).toLowerCase();
  if (Array.isArray(raw)) return raw.some((t) => String(t).toLowerCase() === wanted);
  return String(raw ?? '').toLowerCase() === wanted;
}

// HTTP-hjälpare. Används av skannern, som till skillnad från receptbokens
// import faktiskt *är* en crawler: den sveper flera scener varje natt. Hyfsen
// väger därför tyngre än förr – identifiera oss ärligt, backa av vid 429, ge
// upp i tid, och håll takten låg i adaptrarna.
//
// Håll filen fri från Node-API:er. Den ska kunna köras både av node --test och
// av Cloudflare Pages Functions, som kör på Workers.

// Adressen i strängen är avsiktlig: en scen som undrar vem som hämtar ska kunna
// ta reda på det och höra av sig, utan att först behöva blockera oss.
//
// Bara ASCII. Node skickar huvuden som Latin-1, så ett ö blir byten 0xF6.
// Scenerna tålde det, men PostgREST lägger huvudena i request.headers och
// kraschar på allt som inte är UTF-8 - varje skrivning till Supabase gav
// "500 Something went wrong" i en vecka, och det enda spåret var "Cannot
// decode byte '\xf6'" i PostgREST-loggen.
export const USER_AGENT =
  'kulturkalender/0.1 (+https://github.com/Econcar/kulturkalender; evenemangsindex, Stockholm)';

export class HttpError extends Error {
  constructor(status, url, body, headers = {}) {
    super(`HTTP ${status} för ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
    // Vem som svarade, inte bara vad. Ett 500-svar från en proxy säger
    // ingenting om man inte vet vilket lager som skickade det: en tom kropp
    // från en gateway och ett fel från applikationen bakom den ser identiska
    // ut i loggen men har helt olika orsaker. Supabase svarade "Something went
    // wrong" i sex nattkörningar, och det gick inte att avgöra om det kom från
    // deras gateway, från PostgREST eller från Postgres.
    this.headers = headers;
  }
}

// Huvuden som säger något om vilket lager som svarade. Vitlistade och inte
// alla: ett felobjekt med trettio huvuden i loggen läser ingen.
const DIAGNOSTIC_HEADERS = [
  'server', 'via', 'x-request-id', 'sb-request-id', 'sb-gateway-version',
  'x-envoy-upstream-service-time', 'cf-ray', 'content-type', 'retry-after',
];

function diagnostics(headers) {
  const ut = {};
  for (const namn of DIAGNOSTIC_HEADERS) {
    const värde = headers?.get?.(namn);
    if (värde) ut[namn] = värde;
  }
  return ut;
}

/**
 * fetch med timeout, retry och exponentiell backoff.
 * Retriar bara på 429/5xx och nätverksfel – 404 är ett svar, inte ett fel att tjata om.
 */
export async function fetchWithRetry(url, {
  retries = 3,
  timeoutMs = 20000,
  backoffMs = 1000,
  headers = {},
  ...init
} = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, 'accept-language': 'sv-SE,sv;q=0.9', ...headers },
      });

      if (res.ok) return res;

      const retryable = res.status === 429 || res.status >= 500;
      const body = await res.text().catch(() => '');
      lastError = new HttpError(res.status, url, body.slice(0, 500), diagnostics(res.headers));
      if (!retryable || attempt === retries) throw lastError;

      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : backoffMs * 2 ** attempt);
    } catch (err) {
      if (err instanceof HttpError) {
        if (attempt === retries) throw err;
      } else {
        lastError = err;
        if (attempt === retries) throw err;
        await sleep(backoffMs * 2 ** attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`fetch misslyckades för ${url}`);
}

export async function fetchJson(url, init) {
  const res = await fetchWithRetry(url, {
    ...init,
    headers: { accept: 'application/json', ...init?.headers },
  });
  return res.json();
}

export async function fetchText(url, init) {
  const res = await fetchWithRetry(url, init);
  return res.text();
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Namnet i USER_AGENT, som en robots.txt kan rikta regler till. */
export const ROBOTNAMN = 'kulturkalender';

/**
 * Om robots.txt tillåter adressen. Följer RFC 9309.
 *
 * Den förra versionen läste bara ett rakt "Disallow: /sökväg". Den förstod
 * inte * och $ - "Disallow: /*?filter=" spärrade alltså ingenting - och
 * tappade *-gruppen när den stod ihop med en annan robot på raden ovanför. Den
 * sa ja oftare än sajterna menade, och att respektera robots.txt är en
 * princip här, inte en artighet.
 *
 * Går filen inte att läsa avgör svaret: 4xx betyder att det inte finns någon
 * och att allt är tillåtet, men serverfel och nätfel betyder att vi inte vet -
 * och då hämtar vi inget. Det kastas som ett fel med orsaken i, så att
 * adapterns larm säger vad som hände i stället för "robots.txt tillåter inte".
 *
 * Filen hämtas en gång per sajt och körning.
 */
export async function isAllowedByRobots(url, { userAgent = ROBOTNAMN, hämta = fetchWithRetry } = {}) {
  const target = new URL(url);
  const text = await robotsFil(target.origin, hämta);
  return robotsTillåter(text, target.pathname + target.search, userAgent);
}

const robotsfiler = new Map();

function robotsFil(origin, hämta) {
  if (!robotsfiler.has(origin)) {
    const svar = läsRobots(origin, hämta);
    robotsfiler.set(origin, svar);
    // Ett fel sparas inte: nästa adapter mot samma sajt får försöka igen.
    svar.catch(() => robotsfiler.delete(origin));
  }
  return robotsfiler.get(origin);
}

async function läsRobots(origin, hämta) {
  try {
    const res = await hämta(`${origin}/robots.txt`, { retries: 2, timeoutMs: 10000 });
    return await res.text();
  } catch (err) {
    const status = err?.status;
    if (status >= 400 && status < 500 && status !== 429) return '';
    throw new Error(`robots.txt för ${origin} gick inte att läsa (${err?.message ?? err}) - hämtar inget`);
  }
}

/**
 * Själva prövningen, utan nät. sökväg är sökväg plus frågesträng.
 *
 * Grupperna: följande User-agent-rader delar på reglerna under dem. Den grupp
 * som namnger oss gäller, annars *-gruppen; flera grupper för samma robot slås
 * ihop. Den längsta matchande regeln vinner, och Allow vinner vid lika längd.
 */
export function robotsTillåter(text, sökväg, userAgent = ROBOTNAMN) {
  if (sökväg === '/robots.txt') return true;

  const grupper = [];
  let grupp = null;
  let blandAgenter = false;
  for (const rad of String(text ?? '').split(/\r?\n/)) {
    const ren = rad.split('#')[0].trim();
    const kolon = ren.indexOf(':');
    if (kolon < 1) continue;
    const nyckel = ren.slice(0, kolon).trim().toLowerCase();
    const värde = ren.slice(kolon + 1).trim();

    if (nyckel === 'user-agent') {
      if (!blandAgenter) {
        grupp = { agenter: [], regler: [] };
        grupper.push(grupp);
      }
      grupp.agenter.push(värde.toLowerCase());
      blandAgenter = true;
    } else {
      blandAgenter = false;
      if (grupp && (nyckel === 'allow' || nyckel === 'disallow') && värde) {
        grupp.regler.push({ allow: nyckel === 'allow', mönster: värde });
      }
    }
  }

  const namn = userAgent.toLowerCase();
  const egna = grupper.filter((g) => g.agenter.includes(namn));
  const gäller = egna.length ? egna : grupper.filter((g) => g.agenter.includes('*'));

  const mål = avkoda(sökväg);
  let bästa = null;
  for (const regel of gäller.flatMap((g) => g.regler)) {
    if (!mönsterTräffar(regel.mönster, mål)) continue;
    const längd = regel.mönster.length;
    if (!bästa || längd > bästa.längd || (längd === bästa.längd && regel.allow)) {
      bästa = { längd, allow: regel.allow };
    }
  }
  return bästa ? bästa.allow : true;
}

/** "/*?filter=" och "/sok$": * är vad som helst, $ på slutet är slutet. */
function mönsterTräffar(mönster, sökväg) {
  const ankrat = mönster.endsWith('$');
  const kropp = avkoda(ankrat ? mönster.slice(0, -1) : mönster);
  const regex = kropp.split('*').map((del) => del.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${regex}${ankrat ? '$' : ''}`).test(sökväg);
}

/** Procentkodat och okodat ska jämföras lika: /p%C3%A5-annan-plats är /på-annan-plats. */
function avkoda(text) {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

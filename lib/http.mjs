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

/**
 * Enkel robots.txt-koll. Inte en fullständig implementation – men den fångar
 * ett rakt "Disallow: /sökväg" för vår user-agent eller *.
 */
export async function isAllowedByRobots(url, { userAgent = '*' } = {}) {
  const target = new URL(url);
  let text;
  try {
    text = await fetchText(`${target.origin}/robots.txt`, { retries: 1, timeoutMs: 8000 });
  } catch {
    return true; // ingen robots.txt att läsa → inget uttalat förbud
  }

  const rules = [];
  let applies = false;
  for (const line of text.split(/\r?\n/)) {
    const clean = line.split('#')[0].trim();
    if (!clean) continue;
    const [rawKey, ...rest] = clean.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      applies = value === '*' || value.toLowerCase() === userAgent.toLowerCase();
    } else if (applies && (key === 'disallow' || key === 'allow')) {
      rules.push({ allow: key === 'allow', path: value });
    }
  }

  const path = target.pathname + target.search;
  const match = rules
    .filter((rule) => rule.path && path.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length)[0];

  return match ? match.allow : true;
}

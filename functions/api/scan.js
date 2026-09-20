// Startar ett skanningssvep från sidan.
//
// POST startar jobbet, GET svarar med hur det går. Båda kräver nyckeln i
// huvudet x-scan-key, jämförd mot SCAN_TRIGGER_KEY i Pages-miljön.
//
// Varför en nyckel på en sida som annars är helt öppen: allt annat här är
// läsning, och läsning kostar ingenting. Den här knappen hämtar ett par hundra
// sidor från fyra kulturhus. Utan spärr är den en förstärkare - en bot som
// trycker i en loop gör oss till det trafikmönster som får en IP blockerad,
// och då slutar kalendern fungera för alla. Nyckeln skyddar alltså inte oss
// utan källorna.
//
// Funktionen rör aldrig databasen. Den talar bara med GitHub Actions, som kör
// samma jobb som det nattliga schemat.

import { fail, json, options } from './_shared.js';
import { mayTrigger, secretsEqual, COOLDOWN_MINUTER } from '../../lib/scan-trigger.mjs';

const REPO = 'Econcar/kulturkalender';
const WORKFLOW = 'scan.yml';

export const onRequestOptions = options;

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return fail('fel eller saknad nyckel', 401);

  try {
    const run = await latestRun(env);
    return json({ run, cooldown_minutes: COOLDOWN_MINUTER, ...mayTrigger({ lastRun: run }) }, { maxAge: 0 });
  } catch (err) {
    return fail(err.message, 502);
  }
}

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return fail('fel eller saknad nyckel', 401);

  let run;
  try {
    run = await latestRun(env);
  } catch (err) {
    return fail(err.message, 502);
  }

  const beslut = mayTrigger({ lastRun: run });
  if (!beslut.ok) {
    // 429 och inte 400: det är inte anropet som är fel, det är takten.
    return json({ started: false, ...beslut, run }, { status: 429, maxAge: 0 });
  }

  try {
    await github(env, `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'main' }),
    });
  } catch (err) {
    return fail(`kunde inte starta jobbet: ${err.message}`, 502);
  }

  // GitHub svarar 204 utan att säga vilken körning som skapades, och den dyker
  // upp i listan först efter någon sekund. Klienten frågar med GET i stället.
  return json({ started: true, cooldown_minutes: COOLDOWN_MINUTER }, { maxAge: 0 });
}

function authorized(request, env) {
  const nyckel = env.SCAN_TRIGGER_KEY;
  // Saknas nyckeln i miljön är knappen avstängd, inte öppen.
  if (!nyckel) return false;
  return secretsEqual(request.headers.get('x-scan-key'), nyckel);
}

/** Senaste körningen av skanningsjobbet, eller null om ingen finns. */
async function latestRun(env) {
  const data = await github(env, `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`);
  const run = data?.workflow_runs?.[0];
  if (!run) return null;

  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    event: run.event,
    url: run.html_url,
  };
}

async function github(env, path, init = {}) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN saknas i Pages-miljön');

  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      // GitHub avvisar anrop utan user-agent.
      'user-agent': 'kulturkalender-pages-function',
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub svarade ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

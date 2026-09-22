// Knappen som hämtar nytt från scenerna.
//
// Den syns inte för besökare. Sidan är publik och har ingen inloggning, så
// kontrollerna visas bara när adressen bär ?drift eller när en nyckel redan
// ligger sparad i webbläsaren. Den riktiga spärren sitter ändå i
// functions/api/scan.js, som kräver nyckeln i huvudet - att gömma en knapp är
// inget skydd, det är bara städning.
//
// Knappen startar samma GitHub Actions-jobb som det nattliga schemat kör. Den
// skannar alltså inte här i webbläsaren: ett svep hämtar ett par hundra sidor
// och tar fem minuter.

const NYCKELPLATS = 'kulturkalender.driftnyckel';
const POLL_MS = 15000;
const MAX_POLL_MINUTER = 12;

/**
 * Kopplar in driftkontrollerna.
 *
 * onDone anropas när ett svep är klart, så att listan kan hämtas om utan att
 * besökaren behöver ladda sidan.
 */
export function initDrift({ rot, knapp, status, fält, onDone = () => {} } = {}) {
  if (!rot || !knapp || !status) return;

  const synlig = new URLSearchParams(location.search).has('drift') || Boolean(läsNyckel());
  rot.hidden = !synlig;
  if (!synlig) return;

  // En sidladdning nollställer alltid knappen. Utan det kan den stå kvar som
  // låst från en körning som aldrig rapporterade klart, och då händer
  // ingenting när man trycker - vilket ser ut som att knappen är trasig.
  knapp.disabled = false;
  delete knapp.dataset.följer;

  // Fältet syns bara när ingen nyckel är sparad. Tidigare frågade en
  // window.prompt efter den, men Chrome kan tysta dialoger helt - och då
  // returnerade den null, koden avbröt, och ingenting hände. En knapp som inte
  // säger något när man trycker på den är värre än en som säger nej.
  if (fält) {
    fält.hidden = Boolean(läsNyckel());
    fält.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') starta({ knapp, status, fält, onDone });
    });
  }

  knapp.addEventListener('click', () => starta({ knapp, status, fält, onDone }));
  visaLäge({ status, fält });
}

async function starta({ knapp, status, fält, onDone }) {
  // Kvittot på trycket kommer först av allt. Varje väg härifrån skriver något,
  // så att ett tryck aldrig kan se ut som att ingenting hände.
  sätt(status, 'Startar …');

  const nyckel = läsNyckel() ?? (fält?.value ?? '').trim();
  if (!nyckel) {
    if (fält) {
      fält.hidden = false;
      fält.focus();
    }
    sätt(status, 'Skriv driftnyckeln i fältet och tryck igen.', 'warn');
    return;
  }

  knapp.disabled = true;

  try {
    const res = await fetch('/api/scan', { method: 'POST', headers: { 'x-scan-key': nyckel } });
    const data = await res.json().catch(() => ({}));

    if (res.status === 503) {
      // Knappen är inte uppsatt i miljön. Nyckeln är oskyldig - be inte om en ny.
      sätt(status, data.error ?? 'Knappen är inte uppsatt i den här miljön.', 'warn');
      return;
    }
    if (res.status === 401) {
      // Fel nyckel: glöm den, annars sitter man fast med en som aldrig fungerar.
      glömNyckel();
      if (fält) {
        fält.hidden = false;
        fält.value = '';
        fält.focus();
      }
      sätt(status, 'Nyckeln godtogs inte. Skriv en ny i fältet.', 'error');
      return;
    }
    if (res.status === 429) {
      sätt(status, data.reason === 'pågår'
        ? 'En skanning pågår redan.'
        : `För snart. Vänta ${Math.ceil((data.waitSeconds ?? 0) / 60)} minuter.`, 'warn');
      if (data.reason === 'pågår') följ({ knapp, status, onDone, nyckel });
      return;
    }
    if (!res.ok) {
      sätt(status, data.error ?? `Servern svarade ${res.status}`, 'error');
      return;
    }

    sparaNyckel(nyckel);
    if (fält) {
      fält.value = '';
      fält.hidden = true;
    }
    sätt(status, 'Skanningen startad. Tar ungefär fem minuter.');
    följ({ knapp, status, onDone, nyckel });
  } catch (err) {
    sätt(status, `Kunde inte starta: ${err.message}`, 'error');
  } finally {
    // Knappen låses upp av följ() när svepet är klart, men om vi föll ur innan
    // det hann börja ska den inte stå död.
    if (!knapp.dataset.följer) knapp.disabled = false;
  }
}

/** Frågar GitHub hur det går, tills körningen är klar. */
function följ({ knapp, status, onDone, nyckel }) {
  if (knapp.dataset.följer) return;
  knapp.dataset.följer = '1';
  knapp.disabled = true;

  const slut = Date.now() + MAX_POLL_MINUTER * 60_000;

  const tick = async () => {
    if (Date.now() > slut) return sluta('Skanningen tar längre tid än väntat. Ladda om sidan senare.', 'warn');

    let data;
    try {
      const res = await fetch('/api/scan', { headers: { 'x-scan-key': nyckel } });
      data = await res.json();
      if (!res.ok) throw new Error(data.error ?? String(res.status));
    } catch (err) {
      return sluta(`Tappade kontakten: ${err.message}`, 'error');
    }

    const körning = data.run;
    if (!körning || körning.status === 'queued' || körning.status === 'in_progress') {
      sätt(status, 'Skanning pågår …');
      setTimeout(tick, POLL_MS);
      return;
    }

    if (körning.conclusion === 'success') {
      sluta('Klart. Hämtar den nya listan.', 'ok');
      onDone();
    } else {
      // Jobbet finns och loggen säger varför. Länken är mer värd än vår gissning.
      sätt(status, '', null);
      status.append('Skanningen misslyckades. ');
      const länk = document.createElement('a');
      länk.href = körning.url;
      länk.target = '_blank';
      länk.rel = 'noopener';
      länk.textContent = 'Se loggen';
      status.append(länk);
      status.dataset.tone = 'error';
      lås(false);
    }
  };

  const sluta = (text, ton) => {
    sätt(status, text, ton);
    lås(false);
  };
  const lås = (på) => {
    knapp.disabled = på;
    if (!på) delete knapp.dataset.följer;
  };

  setTimeout(tick, 4000);
}

/** Vid inladdning: säg om en skanning redan pågår. */
async function visaLäge({ status, fält }) {
  const nyckel = läsNyckel();
  if (!nyckel) {
    if (fält) fält.hidden = false;
    sätt(status, 'Skriv driftnyckeln och tryck på knappen.');
    return;
  }
  try {
    const res = await fetch('/api/scan', { headers: { 'x-scan-key': nyckel } });

    // Ett avslag här måste synas. Tidigare returnerade den här funktionen tyst
    // på allt som inte var ok, och följden var att en sparad nyckel som slutat
    // gälla gjorde knappen stendöd: fältet göms när en nyckel finns, servern
    // nekar den, och ingenting på sidan berättar varför. Man tryckte på en
    // knapp som redan hade fått nej.
    if (res.status === 503) {
      const data = await res.json().catch(() => ({}));
      sätt(status, data.error ?? 'Knappen är inte uppsatt i den här miljön.', 'warn');
      return;
    }
    if (res.status === 401) {
      glömNyckel();
      if (fält) {
        fält.hidden = false;
        fält.value = '';
      }
      sätt(status, 'Den sparade nyckeln godtogs inte. Skriv en ny i fältet.', 'error');
      return;
    }
    if (!res.ok) {
      sätt(status, `Servern svarade ${res.status}.`, 'error');
      return;
    }

    const data = await res.json();
    if (data.run?.status === 'in_progress' || data.run?.status === 'queued') {
      sätt(status, 'Skanning pågår …');
    } else {
      sätt(status, 'Klar att hämta.');
    }
  } catch {
    // Nätfel får vara tyst: det är en upplysning vid inladdning, inte en
    // förutsättning för att knappen ska gå att trycka på.
  }
}


// localStorage kan kasta i privat läge eller när webbplatsdata är blockerad.
// Knappen ska fungera ändå, bara utan att komma ihåg nyckeln.
function läsNyckel() {
  try {
    return localStorage.getItem(NYCKELPLATS) || null;
  } catch {
    return null;
  }
}

function sparaNyckel(nyckel) {
  try {
    localStorage.setItem(NYCKELPLATS, nyckel);
  } catch {
    // Får glömmas. Nästa tryck frågar igen.
  }
}

function glömNyckel() {
  try {
    localStorage.removeItem(NYCKELPLATS);
  } catch {
    // Redan borta, eller aldrig sparad.
  }
}

function sätt(el, text, ton) {
  el.textContent = text;
  if (ton) el.dataset.tone = ton;
  else delete el.dataset.tone;
}

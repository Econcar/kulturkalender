// Konstakademien.
//
// WordPress med kalendertillägget EventON. Sidan /pa-gang/ länkar till varje
// evenemang (/events/<slug>/), och varje evenemangssida bär ld+json Event med
// namn, start, slut och bild - nivå 1. Undersökt 2026-10-03; 22 evenemang.
//
// EventON skriver datum utan inledande nolla, "2026-10-7T18:00:00". Det
// klarar parseDateTime sedan samma dag.
//
// Kategorin ur namnet: Konstakademien har utställningar, konstnärssamtal,
// visningar och filmvisningar i samma kalender.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { category, eventNodes, toEvent } from '../../lib/event.mjs';

const BAS = 'https://konstakademien.se';

export default {
  id: 'konstakademien',
  label: 'Konstakademien',
  enabled: true,

  async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots } = {}) {
    if (!(await robotsOk(`${BAS}/pa-gang/`))) throw new Error('robots.txt tillåter inte hämtning');

    const adresser = eventUrls(await hämta(`${BAS}/pa-gang/`));
    log(`  ${adresser.length} evenemang på /pa-gang/`);
    if (!adresser.length) throw new Error('/pa-gang/ länkade inga evenemang - formatet kan ha ändrats');

    const ut = [];
    for (const url of adresser) {
      await paus(1200);
      try {
        ut.push(...rowsFromPage(await hämta(url), url));
      } catch (err) {
        log(`  hoppar över ${url}: ${err.message}`);
      }
    }
    return ut;
  },
};

export function eventUrls(html) {
  return [...new Set([...String(html ?? '').matchAll(/href="(https:\/\/konstakademien\.se\/events\/[a-z0-9-]+\/)"/g)].map((m) => m[1]))];
}

export function rowsFromPage(html, url) {
  return eventNodes(html).map((nod) => {
    const rad = toEvent(nod, { sourceUrl: url });
    if (!rad) return null;
    return {
      ...rad,
      url,
      category: kategori(rad.title, rad.starts_at, rad.ends_at),
      venue_raw: null,
      status: rad.status ?? 'scheduled',
      organizer: 'Konstakademien',
      external_id: `${new URL(url).pathname.split('/').filter(Boolean).pop()}/${rad.starts_at.slice(0, 10)}`,
    };
  }).filter(Boolean);
}

/**
 * Utställning när det pågår över ett dygn, annars ur namnet - och övrigt när
 * namnet inte säger något. "Stadens mjuka makt" är ett samtal klockan 18, och
 * att gissa utställning för allt okänt gjorde det till en.
 */
export function kategori(titel, start, slut) {
  if (slut && new Date(slut) - new Date(start) > 86_400_000) return 'utställning';
  if (/samtal|föreläsning|seminarium|debatt/i.test(titel)) return 'föreläsning';
  if (/film/i.test(titel)) return 'film';
  if (/barn|familj/i.test(titel)) return 'barn';
  const k = category({ genre: titel });
  if (k !== 'övrigt' && k !== 'utställning') return k;
  // Teckna kroki och liknande är verkstäder, inte föredrag, fast de också
  // ligger en vardagskväll.
  if (/kroki|teckna|workshop|verkstad/i.test(titel)) return 'övrigt';

  // Konstakademiens kvällsprogram är föredrag om samlingarna: "Gustaf VI
  // Adolfs teckningssamling" 19-20, "Bonadens bildvärld" 18-19. En timme
  // eller två en vardagskväll, med ett ämne som titel.
  const kväll = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: 'numeric' }).format(new Date(start))) >= 17;
  const kort = slut && new Date(slut) - new Date(start) <= 2.5 * 3600_000;
  return kväll && kort ? 'föreläsning' : 'övrigt';
}

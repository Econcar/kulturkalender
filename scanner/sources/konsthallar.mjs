// Konsthallar och museer utan maskinläsbar data.
//
// Ingen av dem har datum i sitt WordPress-API eller i ld+json, men alla har en
// lista som länkar till utställningarna och ett datumspann i klartext. Två
// former:
//
//   konsthall()      spannet står på varje utställningssida, som läses en i
//                    taget. Artipelag, Sven-Harrys, ArkDes, Tensta.
//   listkonsthall()  spannet står bara i listan, inte på sidan den länkar
//                    till. Accelerator, Marabouparken, Millesgården.
//
// Tolkningen av en sida är gemensam: scanner/lib/utstallning.mjs.
//
// Artipelag undersöktes 2026-10-03, de övriga 2026-11-21. Bortvalda:
//   Magasin III          senaste utställningen i deras API är från 2022.
//   Bonniers Konsthall   byggdes och togs bort samma dag. Sajten svarade
//                        hemifrån men 403 till GitHub Actions - den spärrar
//                        molnets adresser. Det respekteras; att ta sig förbi
//                        en spärr är inte att läsa det en sajt publicerar.
//                        Lista /utstallningar/, länk /utstallning/<slug>/,
//                        datum som "26 aug → 8 nov 2026".
//   Tekniska museet      utställningarna saknar datum - de flesta är fasta.
//   Paradox Museum       en fast utställning.
//   Thielska, Nacka      svarade inte alls 2026-11-21. Värt ett nytt försök.
// Botkyrka konsthall, Konsthall C och Färgfabriken väntar på en närmare titt.

import { fetchText, isAllowedByRobots, sleep } from '../../lib/http.mjs';
import { parseDateRange, spannFrånDelar } from '../../lib/event.mjs';
import { clean } from '../../lib/text.mjs';
import { ingress, sajtbeskrivning, utställning, utställningsrad } from '../lib/utstallning.mjs';

/** En konsthall vars utställningssidor bär datumspannet. */
export function konsthall({ id, label, listor, länk, titelSuffix, spann, kanVaraTom = false }) {
  return {
    id,
    label,
    enabled: true,
    kanVaraTom,

    async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
      if (!(await robotsOk(listor[0]))) throw new Error('robots.txt tillåter inte hämtning');

      const adresser = new Set();
      const generisk = new Set();
      for (const lista of listor) {
        const html = await hämta(lista);
        for (const url of utställningsadresser(html, länk, lista)) adresser.add(url);
        generisk.add(sajtbeskrivning(html));
        await paus(1000);
      }
      log(`  ${adresser.size} utställningssidor`);
      if (!adresser.size) throw new Error('listan länkade inga utställningar - formatet kan ha ändrats');

      const ut = [];
      for (const url of adresser) {
        await paus(1200);
        try {
          const rad = utställningsrad(await hämta(url), url, { organizer: label, titelSuffix, spann, generisk });
          // Listan kan bära det som just stängt; det som har slutat tas inte med.
          if (rad && new Date(rad.ends_at) >= now) ut.push(rad);
        } catch (err) {
          log(`  hoppar över ${url}: ${err.message}`);
        }
      }
      return ut;
    },
  };
}

/**
 * En konsthall vars lista bär datumen. kort(html, listans adress) ger
 * { url, title, image_url, description?, spann } per utställning. Saknar
 * listan ingressen läses utställningssidan för den - men faller sidan bort
 * står raden kvar utan.
 */
export function listkonsthall({ id, label, listor, kort, kanVaraTom = true }) {
  return {
    id,
    label,
    enabled: true,
    kanVaraTom,

    async fetchEvents({ log = console.log, hämta = fetchText, paus = sleep, robotsOk = isAllowedByRobots, now = new Date() } = {}) {
      if (!(await robotsOk(listor[0]))) throw new Error('robots.txt tillåter inte hämtning');

      const per = new Map();
      const generisk = new Set();
      for (const lista of listor) {
        const html = await hämta(lista);
        for (const k of kort(html, lista)) if (!per.has(k.url)) per.set(k.url, k);
        generisk.add(sajtbeskrivning(html));
        await paus(1000);
      }
      log(`  ${per.size} utställningar i listan`);

      const ut = [];
      for (const k of per.values()) {
        if (new Date(k.spann.ends_at) < now) continue;
        let description = k.description ?? null;
        let image_url = k.image_url ?? null;
        if (!description) {
          try {
            await paus(1200);
            const sida = await hämta(k.url);
            description = ingress(sida, generisk);
            image_url ??= sajtbild(sida);
          } catch (err) {
            log(`  ${k.url} gick inte att läsa (${err.message}) - raden står kvar utan ingress`);
          }
        }
        ut.push(utställning({ ...k, description, image_url, organizer: label }));
      }
      return ut;
    },
  };
}

/** og:image, för listkonsthallarnas sidor. */
function sajtbild(html) {
  return /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/.exec(String(html ?? ''))?.[1] ?? null;
}

/** Utställningsadresserna i listan, var och en en gång, som hela adresser. */
export function utställningsadresser(html, länk, bas) {
  return [...new Set([...String(html ?? '').matchAll(länk)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), bas).href))];
}

// --- Datum i husens egna former ----------------------------------------------

/** ArkDes: "Startar 2026.10.23 - Slutar 2027.09.26". */
export function arkdesSpann(text) {
  const m = /Startar\s+(\d{4})\.(\d{1,2})\.(\d{1,2})\s*[-–]\s*Slutar\s+(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(String(text ?? ''));
  return m ? spannFrånDelar(m[3], m[2], m[1], m[6], m[5], m[4]) : null;
}

/** Tensta konsthall: "11.9 2026—10.1 2027", där startåret kan saknas. */
export function tenstaSpann(text) {
  const m = /(\d{1,2})\.(\d{1,2})(?:\s+(\d{4}))?\s*[—–-]\s*(\d{1,2})\.(\d{1,2})\s+(\d{4})/.exec(String(text ?? ''));
  return m ? spannFrånDelar(m[1], m[2], m[3], m[4], m[5], m[6]) : null;
}

// --- Listorna ------------------------------------------------------------------

/**
 * Accelerator: ett kort per utställning.
 *   <a href=".../utstallning/aerpiemaahtoe/" class="exhibition-list-teaser__wrapper">
 *     <img src="..."> <span class="...__date">12 sep - 14 feb 2027</span>
 *     <span class="arrow-link__label">Aerpiemaahtoe</span>
 */
export function acceleratorKort(html, bas) {
  const ut = [];
  const block = /<a href="([^"]+)" class="exhibition-list-teaser__wrapper[^"]*">([\s\S]*?)<\/a>/g;
  for (const [, href, inre] of String(html ?? '').matchAll(block)) {
    const spann = parseDateRange(clean(/__content__date[^>]*>([^<]+)</.exec(inre)?.[1]));
    const title = clean(/arrow-link__label">([\s\S]*?)<\/span>/.exec(inre)?.[1]);
    if (!spann || !title) continue;
    ut.push({ url: new URL(href, bas).href, title, image_url: /<img[^>]+src="([^"]+)"/.exec(inre)?.[1] ?? null, spann });
  }
  return ut;
}

/**
 * Marabouparken: bildspelet högst upp i listan, en bild per utställning.
 *   <a href="https://marabouparken.se/berattelser-utan-borjan/"> <img src="...">
 *     <div class="caption"><h1> Éva Mag – berättelser utan början
 *       <span class="pe"> 24 oktober 2026&ndash;7 mars 2027</span></h1>
 */
export function marabouKort(html, bas) {
  const ut = [];
  const block = /<a href="([^"]+)">\s*<img src="([^"]+)"[^>]*>\s*<div class="caption"><h1>([\s\S]*?)<span class="pe"\s*>([\s\S]*?)<\/span>/g;
  for (const [, href, bild, titel, datum] of String(html ?? '').matchAll(block)) {
    const spann = parseDateRange(clean(datum));
    const title = clean(titel);
    if (!spann || !title) continue;
    ut.push({ url: new URL(href, bas).href, title, image_url: bild, spann });
  }
  return ut;
}

/**
 * Millesgården: listsidorna "aktuella" och "kommande" visar utställningen i
 * sin helhet, med datumet i rubriken - utställningens egen sida gör det inte.
 *   <h2> <p>LIV I FÄRG &amp; FORM</p><p> Robert och Barbro Nilsson</p>
 *        <p> 12 september 2026 - 29 mars 2027<br></p> </h2>
 * Rubriken står i versaler; namnet tas i stället ur menyn, som länkar till
 * utställningens sida med titeln skriven som vanligt.
 *
 * Varje sida visar en utställning, och dess rubrik är sidans första; de
 * följande är citat ur recensioner och sidfoten. Kommande utställningar har
 * datumet sist i texten i stället för i rubriken ("<em>17 april - 19
 * september 2027.</em>"), och då tas det därifrån.
 */
export function millesKort(html, bas) {
  const text = String(html ?? '').split('<footer')[0];
  const meny = [...text.matchAll(/href="(\/utstallningar\/(?:aktuella-utstallningar-pa-millesgarden|kommande-utstallningar)\/[a-z0-9-]+)"[^>]*>([^<]+)</g)]
    .map(([, href, namn]) => ({ url: new URL(href, bas).href, namn: clean(namn) }));
  const i = text.indexOf('<div class="article-dynamic-template-header"><h2>');
  if (i < 0) return [];
  const rubrik = /<h2>([\s\S]*?)<\/h2>/.exec(text.slice(i))?.[1] ?? '';
  // Raderna är <p> hos den aktuella och <br> hos den kommande.
  const rader = rubrik.split(/<\/p>|<br\s*\/?>/).map((r) => clean(r)).filter(Boolean);
  const spann = rader.map(parseDateRange).find(Boolean) ?? parseDateRange(clean(text.slice(i)));
  if (!spann) return [];

  const namn = rader.filter((r) => !parseDateRange(r)).join(' ');
  // Menyposten vars namn börjar som rubriken, oavsett skiftläge.
  const början = namn.toLowerCase().split(/\s+/)[0];
  const träff = meny.find((m) => m.namn.toLowerCase().startsWith(början));
  const bild = /data-src='(\/files\/modules\/HtmlArticle\/images\/[^']+)'/.exec(text)?.[1];
  return [{
    url: träff?.url ?? bas,
    title: träff?.namn ?? namn,
    image_url: bild ? new URL(bild, bas).href : null,
    // Utställningens egen sida bär bara museets allmänna beskrivning; listan
    // bär hela texten.
    description: ingress(`<div>${text.slice(i)}</div>`),
    spann,
  }];
}

export default [
  konsthall({
    id: 'artipelag',
    label: 'Artipelag',
    listor: ['https://artipelag.se/pa-gang/utstallning/'],
    länk: /href="(https:\/\/artipelag\.se\/pa-gang\/utstallning\/[a-z0-9-]+\/)"/g,
    titelSuffix: /\s*[-–|]\s*Artipelag$/,
    kanVaraTom: true,
  }),
  konsthall({
    id: 'svenharrys',
    label: 'Sven-Harrys Konstmuseum',
    // Listan bär också tidigare utställningar; de som slutat sorteras bort.
    listor: ['https://sven-harrys.se/utstallningar/'],
    länk: /href="(https:\/\/sven-harrys\.se\/exhibition\/[a-z0-9-]+\/)"/g,
    titelSuffix: /\s*[-–|]\s*Sven-Harrys.*$/i,
  }),
  konsthall({
    id: 'arkdes',
    label: 'ArkDes',
    // Startsidan också: årets pepparkakshus länkas därifrån men inte alltid
    // från listan.
    listor: ['https://arkdes.se/utstallningar/', 'https://arkdes.se/'],
    länk: /href="(https:\/\/arkdes\.se\/utstallningar\/[a-z0-9-]+\/)"/g,
    titelSuffix: /\s*[-–|]\s*ArkDes$/,
    spann: arkdesSpann,
  }),
  konsthall({
    id: 'tenstakonsthall',
    label: 'Tensta konsthall',
    // "Händer på konsthallen" bär både utställningar och skolvisningar. Bara
    // utställningarna har ett spann i husets sifferform.
    listor: ['https://www.tenstakonsthall.se/se', 'https://www.tenstakonsthall.se/se/hander-pa-konsthallen'],
    länk: /href="((?:https:\/\/www\.tenstakonsthall\.se)?\/se\/hander-pa-konsthallen\/[a-z0-9-]+)"/g,
    titelSuffix: /^Tensta konsthall\s*\|\s*/,
    spann: tenstaSpann,
    kanVaraTom: true,
  }),
  listkonsthall({
    id: 'accelerator',
    label: 'Accelerator',
    listor: ['https://acceleratorsu.art/utstallning/'],
    kort: acceleratorKort,
  }),
  listkonsthall({
    id: 'marabouparken',
    label: 'Marabouparken konsthall',
    listor: ['https://marabouparken.se/utstallningar/'],
    kort: marabouKort,
  }),
  listkonsthall({
    id: 'millesgarden',
    label: 'Millesgården',
    listor: [
      'https://www.millesgarden.se/utstallningar/aktuella-utstallningar-pa-millesgarden',
      'https://www.millesgarden.se/utstallningar/kommande-utstallningar',
    ],
    kort: millesKort,
  }),
];

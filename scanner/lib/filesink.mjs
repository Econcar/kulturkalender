// Skriver skannerns rader till en JSON-fil i stället för till Supabase.
//
// Finns för att hela kedjan ska gå att köra och titta på utan databas: kör
// `npm run scan:local`, starta `npm run dev`, och sidan visar riktiga
// evenemang. Utan den här går det inte att se sidan fungera förrän Supabase
// är uppsatt, och då upptäcks fel i gränssnittet långt senare än de behöver.
//
// Samma gränssnitt som scanner/lib/supabase.mjs: upsertEvents, startRun och
// dryRun. run.mjs ska inte behöva veta vilken av dem den fått.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createFileClient(path) {
  const körningar = [];

  return {
    dryRun: false,
    path,

    /**
     * Slår ihop med det som redan ligger i filen, på samma nyckel som
     * databasen använder: (source, external_id).
     *
     * Sammanslagningen är inte överflödig lokalt. Kör man en källa i taget
     * ska den andras rader ligga kvar, precis som i databasen – annars beter
     * sig det lokala läget annorlunda än det skarpa och slutar vara ett prov.
     */
    async upsertEvents(events) {
      const befintliga = await läsFil(path);
      const nyckel = (e) => `${e.source}|${e.external_id}`;
      const karta = new Map(befintliga.map((e) => [nyckel(e), e]));

      const nu = new Date().toISOString();
      for (const event of events ?? []) {
        const gammal = karta.get(nyckel(event));
        karta.set(nyckel(event), {
          ...event,
          // first_seen_at sätts en gång och rörs inte, som i schemat.
          first_seen_at: gammal?.first_seen_at ?? nu,
          last_seen_at: nu,
        });
      }

      const rader = [...karta.values()].sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(rader, null, 2)}\n`, 'utf8');

      return events?.length ?? 0;
    },

    async startRun(source) {
      const start = Date.now();
      return async (result) => {
        körningar.push({ source, ...result, ms: Date.now() - start });
      };
    },

    körningar,
  };
}

async function läsFil(path) {
  try {
    const text = await readFile(path, 'utf8');
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    // Filen finns inte eller är trasig – börja om. Det är en lokal cache,
    // inte data någon är beroende av.
    return [];
  }
}

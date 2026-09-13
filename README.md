# Kulturkalendern

Vad som händer på Stockholms scener – konserter, teater, utställningar och film –
hämtat automatiskt från arrangörernas egna sidor och samlat på ett ställe.

Startdokument: [docs/projektstart.md](docs/projektstart.md)

> Projektet är en ombyggnad av receptboken, som i sin tur byggdes av en nedlagd
> leasingskanner. Stacken, PWA-skalet, `ld+json`-läsaren och skannermotorn är
> ärvda och genomtestade; domänkoden är ny. Historiken finns kvar i git.

## Stack

| Del | Teknik |
| --- | --- |
| Frontend | Statisk PWA på Cloudflare Pages (`public/`), inget byggsteg |
| Skanner | GitHub Actions på schema (`scanner/`), en adapter per scen |
| Proxy | Cloudflare Pages Functions (`functions/api/*.js`) → `/api/<namn>` |
| Databas | Supabase (Postgres + RLS). Ingen inloggning |
| Delad logik | `lib/`, skriven för både Node och Workers |
| Tester | Nodes inbyggda `node --test` (inga beroenden) |

Projektet ligger på Google Drive (G:\) där lokala `npm install` är opålitliga –
därför **inga npm-beroenden**, inget byggsteg, och deploy via GitHub → Cloudflare
(inte lokalt).

## Mappar

```
public/              Statisk frontend (Cloudflare Pages root)
  index.html/app.js    Listsidan: kommande evenemang, dag för dag
  format.js            Rena formateringsfunktioner – testbara utan webbläsare
scanner/             Skannern. Körs av GitHub Actions, inte av webbläsaren
  run.mjs              Motorn: kör källorna isolerat, loggar till scan_runs
  sources/             En adapter per scen. Börja i _template.mjs
  lib/                 Dubblettfilter och Supabase-skrivning med service-nyckeln
functions/api/       Pages Functions, en fil per endpoint
lib/                 Delad logik: ld+json, HTTP, Event-tolkning, textstädning.
                     Inga Node-API:er – koden körs både i Node och på Workers
db/                  SQL-schema för Supabase + RLS-testet
tests/               node --test
scripts/             Pre-deploy-spärr m.m.
docs/                Projektdokumentation
```

## Kommandon

```bash
npm test          # node --check på alla .js + node --test tests/
npm run check     # bara syntaxkontroll
npm run scan      # kör skannern mot Supabase
npm run scan:dry  # kör skannern utan att skriva något
npm run predeploy # pre-deploy-spärr (körs av pre-push-hooken)
```

Installera pre-push-spärren en gång per klon:

```bash
git config core.hooksPath .githooks
```

## Miljövariabler

**Frontend behöver inga.** Till skillnad från receptboken talar webbläsaren inte
med Supabase – allt går genom `/api/events`, och nycklarna stannar på servern.

Pages Functions (Cloudflare → Settings → **Variables and Secrets**). Variabler
slår igenom först efter en ny deploy:

| Namn | Typ | Beskrivning |
| --- | --- | --- |
| `SUPABASE_URL` | Text | `https://<projekt>.supabase.co` – **bara roten**, ingen sökväg |
| `SUPABASE_ANON_KEY` | Text | Publik anon-nyckel. Läser via RLS, kan inte skriva |

Skannern (GitHub → Settings → Secrets and variables → **Actions**):

| Namn | Typ | Beskrivning |
| --- | --- | --- |
| `SUPABASE_URL` | Secret | Samma rot som ovan |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Går förbi RLS. Får aldrig hamna i `public/` – pre-deploy-spärren letar efter den |

## Uppsättning

1. **Supabase:** projekt → SQL Editor → kör [db/schema.sql](db/schema.sql), och
   därefter [db/rls-test.sql](db/rls-test.sql) som ska sluta med
   *RLS-testet gick igenom*. Testet rullar tillbaka sig självt och lämnar inga
   spår.

   Återanvänds receptbokens Supabase-projekt körs
   [db/drop-receptbok.sql](db/drop-receptbok.sql) först – en gång, medvetet.
   **Exportera recepten innan.** De är inmatade för hand och går inte att skanna
   fram igen.
2. **Cloudflare Pages:** projekt kopplat till repot. Build command: *(tomt)*.
   Build output directory: `public`. Functions hittas automatiskt i `functions/`.
3. **GitHub Actions:** lägg in skannerns secrets. Kör
   [scan.yml](.github/workflows/scan.yml) med `workflow_dispatch` och
   *Skriv inget till Supabase* ikryssat första gången.

**Läs [avsnitt 11 i projektstart.md](docs/projektstart.md) före uppsättningen.**
Där står sex fällor som kostat kvällar förut – bland annat att Supabases nya
`sb_secret_`-nycklar inte fungerar mot Data API:t, och att `SUPABASE_URL` inte
får innehålla `/rest/v1/`.

## Status

- [x] Pivoten: receptdomänen bort, skannerstommen tillbaka, nytt schema
- [x] `lib/ldjson.mjs` – koden oförändrad genom tre domäner (Product → Recipe → Event)
- [x] `lib/event.mjs` – schema.org `Event` till en rad, med tidszonen uttolkad
- [x] Publik listsida med kategorifilter och sökning
- [x] RLS: alla läser, ingen skriver – bevisat med `db/rls-test.sql`
- [ ] Fas 2: adapter för Kulturhuset Stadsteatern (`ld+json`, verifierad källa)
- [ ] Fas 4: adaptrar för Dramaten (`__NEXT_DATA__`) och Konserthuset (`og:`)
- [ ] Fas 5: dubbletter mellan källor – `groupDuplicates` finns, används inte
- [ ] Utred Operan, Fotografiska, Moderna Museet, Stockholm Live och Debaser.
      Bara deras listsidor har testats, vilket inte säger något

## Namn och adress

Repot heter fortfarande `receptbok` och sidan ligger på `receptbok.pages.dev`.
Båda behöver döpas om i GitHub respektive Cloudflare – koden är redan omskriven.

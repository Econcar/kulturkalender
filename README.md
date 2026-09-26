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
  drift.js             Skanningsknappen. Döljs för besökare, kräver nyckel
  index.html/app.js    Listsidan: kommande evenemang, dag för dag
  api.js               Samtalet med /api/events – skilt från app.js för att
                       kunna testas; app.js rör document redan vid import
  format.js            Rena formateringsfunktioner – testbara utan webbläsare
scanner/             Skannern. Körs av GitHub Actions, inte av webbläsaren
  reviews/run.mjs      Recensionsläsningen. Samlar in och matchar, skriver
                       inget - se avsnitt 7b i docs/projektstart.md
  run.mjs              Motorn: kör källorna isolerat, loggar till scan_runs
  sources/             En adapter per scen. Börja i _template.mjs
  lib/                 Dubblettfilter, Supabase-skrivning med service-nyckeln,
                       och filesink.mjs som skriver till JSON i stället
functions/api/       Pages Functions, en fil per endpoint
  news.js              Nyhetsvyn: nya uppsättningar ur first_seen_at, och
                       recensioner matchade mot flödena vid förfrågan
lib/                 Delad logik: ld+json, HTTP, Event-tolkning, textstädning.
                     Inga Node-API:er – koden körs både i Node och på Workers
db/                  SQL-schema för Supabase + RLS-testet
tests/               node --test
scripts/             Pre-deploy-spärr och den lokala utvecklingsservern
data/                Lokal skannerutdata. Gitignorerad
docs/                Projektdokumentation
```

## Kommandon

```bash
npm test           # node --check på alla .js + node --test tests/
npm run check      # bara syntaxkontroll
npm run scan:local # skanna till data/events.json (ingen databas behövs)
npm run reviews    # läs kultursektionernas flöden, matcha, skriv inget till db
npm run dev        # kör sidan lokalt på http://localhost:8788
npm run scan       # kör skannern mot Supabase
npm run scan:dry   # kör skannern utan att skriva något
npm run predeploy  # pre-deploy-spärr (körs av pre-push-hooken)
```

### Köra lokalt

Sidan går att köra utan Supabase och utan Cloudflare-verktyg:

```bash
npm run scan:local   # hämtar från scenerna, skriver data/events.json
npm run dev          # serverar public/ och /api/events ur den filen
```

`data/` är gitignorerad – det är hämtat från andras sajter, inte vårt att
checka in, och alltid en körning bort.

Den lokala servern är ett titthål, inte en simulering. Urvalet görs av
[lib/upcoming.mjs](lib/upcoming.mjs) i JS i stället för av SQL-vyn, och det
finns varken cache eller CORS-huvuden. Fälten är däremot desamma, och
`tests/upcoming.test.mjs` läser kolumnlistan ur `db/schema.sql` och jämför –
glider de isär faller testet.

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
| `SCAN_TRIGGER_KEY` | **Secret** | Lösenord för skanningsknappen. Saknas den är knappen avstängd |
| `GITHUB_TOKEN` | **Secret** | Fine-grained PAT med *Actions: Read and write* på detta repo. Endast det |

Skannern (GitHub → Settings → Secrets and variables → **Actions**):

| Namn | Typ | Beskrivning |
| --- | --- | --- |
| `SUPABASE_URL` | Secret | Samma rot som ovan |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Går förbi RLS. Får aldrig hamna i `public/` – pre-deploy-spärren letar efter den |

## Uppsättning

1. **Supabase:** projekt → SQL Editor → kör [db/schema.sql](db/schema.sql), och
   därefter [db/rls-test.sql](db/rls-test.sql), som ska svara med en enda rad:
   *RLS-testet gick igenom*. Testet rullar tillbaka sig självt och lämnar inga
   spår.

   Editorn visar inte `raise notice`, bara resultatrader – går testet igenom
   utan den avslutande raden är det en gammal version av filen du kör.
   Misslyckas något höjs ett fel, och då står det rött i stället.

   Kontrollera sedan att husen finns: `select slug, name from public.venues
   order by slug;` ska ge sex rader.

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
- [x] Fas 2: adapter för Kulturhuset Stadsteatern – går via kategorisidorna,
      inte sitemapen, som till 80 % är arkiv
- [x] Adapter för Dramaten – `__NEXT_DATA__` i stället för `ld+json`, och en
      rad per föreställning i stället för ett spann per uppsättning
- [x] Adapter för Konserthuset – kalendern visade sig vara mikrodata och inte
      `og:`-taggar, så den bär både pris och sluttid. Hela programmet i sex anrop
- [x] Nattlig skanning påslagen i `.github/workflows/scan.yml` (04:12 UTC)
- [x] Adapter för Kungliga Operan – rent JSON ur `webapi.operan.se`, som bara
      refereras från en chunk huvudbunten importerar. Bokfördes först som omöjlig
- [x] Datumfilter i gränssnittet: i dag, i morgon, i helgen, den här veckan
- [x] Speltid på kortet: "Spelas 13 september – 8 november" när en rad täcker
      mer än en kväll
- [x] Recensioner: sparas i `reviews` av den nattliga insamlingen, visas på
      korten och i nyhetsvyn. Se avsnitt 7b i projektstart.md
- [x] Södra Teatern och Folkoperan (2026-09-26). Playhouse och Orion valdes
      bort: deras datum finns bara hos Tickster, som stänger allt i robots.txt
- [ ] Fas 5: dubbletter mellan källor – `groupDuplicates` finns, används inte
- [ ] Utred Fotografiska, Moderna Museet, Stockholm Live och Debaser.
      Bara deras listsidor har testats, vilket inte säger något

## Namn och adress

Koden pekar på `kulturkalender`: paketnamnet, och user-agenten i
`lib/http.mjs` som scenerna ser i sina loggar när skannern hämtar.

Kvar att göra för hand, eftersom de ligger utanför repot:

1. **Döp om repot i GitHub** till `kulturkalender` (Settings → Repository name).
   GitHub omdirigerar den gamla adressen efteråt, men inte innan – så byt namn
   **före** nästa push, annars pekar user-agenten på en 404 under tiden.
2. `git remote set-url origin https://github.com/Econcar/kulturkalender.git`
3. **Döp om Cloudflare Pages-projektet**, vilket ger `kulturkalender.pages.dev`.
   Den gamla adressen slutar fungera direkt – Cloudflare omdirigerar inte.

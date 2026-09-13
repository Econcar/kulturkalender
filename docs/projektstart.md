# Projektstart: Kulturkalendern

> Startdokument för det projekt som ersätter receptboken. Samma stack, ny domän.
> Utkast 2026-09-13 – avsnitt 10 är beslut som ska fattas innan bygget går vidare.

## 1. I en mening

En publik webbsida som samlar vad som händer på Stockholms scener – konserter,
teater, utställningar och film – på ett ställe, med länk vidare till arrangören.

## 2. Mål och avgränsning

- **Måste:** hämta evenemang automatiskt från arrangörernas egna sidor, visa dem
  i datumordning, och gå att filtrera på kategori och söka i.
- **Vill:** fler scener, dubblettsammanslagning mellan källor, kartvy.
- **Inte nu:** inloggning, bevakningar, biljettförsäljning, recensioner,
  användarinlagda evenemang.

Sidan är **publik och läsbar för alla**. Det är en medveten avgränsning som tar
bort inloggning, RLS-policyer för skrivning, och hela modereringsfrågan ur
bygget – ingen utomstående kan lägga in något, så det finns inget att moderera.

Priset för den avgränsningen är att allt innehåll måste komma från skannern.
Går en källa sönder finns ingen människa som fyller i luckan.

## 3. Arkitektur (ärvd, beprövad)

- **Frontend:** statisk PWA på **Cloudflare Pages**, inget byggsteg.
- **Skanner:** **GitHub Actions** på schema, en adapter per scen. Motorn är
  leasingskannerns – samma problem, samma lösning.
- **Proxy:** **Cloudflare Pages Functions**. `/api/events` läser ur Supabase med
  anon-nyckeln, så nyckeln aldrig behöver ligga i webbläsaren.
- **Databas:** **Supabase** (Postgres + RLS). Ingen auth.

Säkerhetsmodellen är omvänd mot receptbokens och värd att säga rakt ut: alla får
läsa allt, ingen får skriva något. Skannern skriver med service-nyckeln, som går
förbi RLS och bara finns i GitHub Actions-secrets. `db/rls-test.sql` bevisar det
genom att försöka skriva som anon och kräva att bli nekad.

**Frontenden talar inte med Supabase.** Det är en skillnad mot receptboken, där
webbläsaren höll en egen klient. Här går allt genom `/api/events`, vilket betyder
att `public/config.js` är borta och att anon-nyckeln inte längre är publicerad.
Den ligger i Pages-miljön i stället.

Pages Functions kör på Workers, inte Node. Delad kod i `lib/` får därför bara
använda webbstandarder (`fetch`, `URL`, `JSON`, `Intl`) – inga Node-moduler.

## 4. Källorna: undersökt, inte antaget

Åtta scener testades 2026-09-13, på deras faktiska evenemangssidor och inte bara
på startsidan. Resultatet styr hela bygget, så det står här i sin helhet.

| Scen | Vad sidan bär | Nivå |
| --- | --- | --- |
| Kulturhuset Stadsteatern | Fullständig `ld+json` `@type: Event` | 1 |
| Dramaten | `__NEXT_DATA__` med `performances[]` | 2 |
| Konserthuset | Bara `og:`-taggar + datum i URL-slugen | 3 |
| Operan, Fotografiska, Moderna Museet, Stockholm Live, Debaser | **Inte utrett** – bara listsidor nåddes | ? |

**De fem sista är inte ett besked.** En listsida bär aldrig `Event`, inte hos
Kulturhuset heller. De måste testas på en enskild evenemangssida innan någon
säger något om dem.

Tre extraktionsnivåer, alla tre verifierade:

1. **`ld+json` `@type: Event`.** Kulturhusets block bär namn, bild, beskrivning,
   genre, start, slut, plats, pris, biljettlänk och arrangör. `lib/event.mjs`
   läser det rakt av.

   Två saker som bara syntes när adaptern byggdes: `price` kan vara strängen
   `"175-350"` trots att schema.org säger tal, och sajtens `sitemap.xml` är till
   80 % arkiv – 980 adresser varav merparten är gamla uppsättningar med
   `"startDate": null`. Adaptern går därför via kategorisidorna, som är sajtens
   egen bild av vad som spelas nu.
2. **Inbäddad JSON.** Dramaten publicerar inget `ld+json` alls, men lägger hela
   sidan i `__NEXT_DATA__` – med tolv föreställningsdatum, speltid, medverkande
   och kategorier. Rikare än deras `ld+json` hade varit. Egen tolkning, men JSON
   och inte HTML.
3. **`og:`-taggar och URL-mönster.** Konserthuset har varken `ld+json` eller
   sitemap. Men `og:title` lyder `"Schumanns tredje symfoni 2026-09-16 kl 18.00"`
   och slugen bär `20260916-1800`, vilket ger både en exakt tid och ett stabilt
   `external_id`. Räcker till titel, tid, bild och länk. Inte till pris eller
   beskrivning.

**Slutsatsen:** källorna är ojämna, och en generisk skrapa räcker inte. Därför en
adapter per scen, med samma kontrakt men egen tolkning – exakt det mönster
leasingskannern hade. Adaptern ska säga vad den *inte* kan få fram hellre än att
gissa.

`robots.txt` kollades för alla tre: ingen förbjuder hämtning av programsidorna.
Dramaten stänger `/en`, Konserthuset stänger `/episerver/cms`. Adaptrarna kallar
ändå `isAllowedByRobots` före varje svep – reglerna kan ändras.

## 5. Datamodell

```
venues (id, slug, name, url, address, lat, lng)

events (
  id, source, external_id, url,
  title, description, image_url,
  category, genre,
  venue_id, venue_raw, address,
  starts_at, ends_at,
  price_min, price_max, currency, ticket_url,
  status,                      -- scheduled | cancelled | postponed | …
  raw,                         -- hela blocket källan publicerade
  first_seen_at, last_seen_at, created_at, updated_at
)
unique (source, external_id)

scan_runs (id, source, status, rows_found, rows_upserted, error, started_at, finished_at)
```

Tre principer ärvda rakt av:

**`raw` sparas alltid**, även när tolkningen lyckas. Samma sak som `raw_text` i
receptboken och `raw` i leasingens `listings`: parsern kan förbättras i efterhand
utan att något skannas om, och när den har fel syns originalet bredvid.

**`last_seen_at` i stället för radering.** Ett evenemang som slutar dyka upp hos
källan är antingen inställt, slutsålt eller passerat – tre olika saker. Skannern
raderar aldrig; raden slutar bara uppdateras och sidan avgör vad den visar.

**`venue_raw` bredvid `venue_id`.** Kopplingen till en scen är en gissning som
kan bli fel. Originalet ska gå att läsa när den gör det.

## 6. Det som följde med från receptboken

| Fil | Vad den blev |
| --- | --- |
| `lib/ldjson.mjs` | **Koden oförändrad**, bara filhuvudet omskrivet. Tredje domänen som läser den: Product → Recipe → Event |
| `lib/http.mjs` | Timeout, retry, backoff, `isAllowedByRobots`. Bara `User-Agent` bytt |
| `lib/recipe.mjs` → `lib/text.mjs` | Textstädarna lyfta ut och gjorda domänoberoende |
| `db/schema.sql` | Mönstren: `touch_updated_at`, `security_invoker`, explicita cast |
| `public/` | PWA-skalet, service workern, versionsmärkningen |
| `scripts/`, `.githooks/`, CI | Oförändrade |

Och ur leasingskannern, tillbakaplockat ur git (`e152c5e^`): `scanner/run.mjs`,
`dedupe.mjs`, `supabase.mjs`, adapterregistret och `scan.yml`.

Att `ldjson.mjs` överlevt två pivoter utan en enda **kodändring** är det
tydligaste beviset på att den är generisk på riktigt och inte bara till namnet.
Enda som skrivits om i den är filhuvudet, som beskriver vad den läser.

## 7. Upphovsrätt – och varför den ändrats

Receptbokens resonemang gick så här: en ingredienslista är en faktauppräkning,
tillagningstexten är skyddad, men kopior för hushållets eget bruk är en annan sak
än publicering. Leasingdata var rena faktauppgifter och gick helt fri.

**Det här projektet är varken.** En publik sida som återger arrangörernas egna
beskrivningstexter publicerar någon annans copy för allmänheten. Skillnaden mot
de två föregående projekten är verklig och måste hanteras i koden, inte i en
avsiktsförklaring.

Hållningen:

- **Titel, datum, tid, plats och pris är fakta.** De återges rakt av.
- **Beskrivningen återges som utdrag, aldrig i sin helhet.** `utdrag()` i
  `public/format.js` kapar vid ~180 tecken, och listan visar tre rader.
- **Varje evenemang länkar till arrangören**, och länken går i första hand till
  deras biljettsida.
- **Sidfoten säger var uppgifterna kommer ifrån.**
- **Bilderna hotlänkas till källan** och sparas inte hos oss. Försvinner bilden
  krymper kortet i stället för att visa en trasig ikon – samma beslut som
  receptboken tog, av samma skäl plus ett upphovsrättsligt.

Skulle någon scen be oss sluta är det rimliga svaret att ta bort dem, inte att
argumentera. En adapter är en fil och en rad i `index.mjs`.

## 8. Faser

1. **Pivoten.** Receptdomänen bort, skannerstommen tillbaka, nytt schema, ny
   listsida. Sidan står tom men hel. ← *klar*
2. **Kulturhuset.** Första adaptern. Nivå 1, minst kod, bevisar hela kedjan från
   hämtning till rad på sidan.
3. **Listsidan på riktigt.** Datumfilter, paginering, tom-tillstånd som säger
   något vettigt.
4. **Dramaten och Konserthuset.** Bevisar att adaptermönstret bär nivå 2 och 3.
5. **Dubbletter mellan källor.** `groupDuplicates` finns; sidan använder den inte
   ännu.
6. **Fler scener.** Börja med att faktiskt utreda de fem från avsnitt 4.

Fas 2 före fas 3 med flit: en lista med riktiga evenemang i är värd att titta på
även utan filter, medan ett filter över en tom databas inte går att bedöma.

## 9. Kvalitet & drift

- Enhetstester på ren logik: `lib/event.mjs`, `dedupe.mjs`, `public/format.js`.
- Pre-deploy-spärr (`node --check` + `node --test`) före push.
- **RLS ska testas, inte antas.** `db/rls-test.sql` försöker skriva som anon och
  kräver att bli nekad. Anon-nyckeln ligger i Pages-miljön, men den läcker förr
  eller senare – det enda som står mellan den och databasen är att det inte finns
  någon skrivpolicy.
- **Skanningen är skör per definition.** En scen kan lägga om sin sida när som
  helst. `scan_runs` loggar varje körning per källa, och `run.mjs` isolerar
  källorna så att en trasig aldrig fäller jobbet. En källa som plötsligt ger noll
  rader loggas som `empty` med en varning – det är oftast ett formatbyte, inte en
  tom vecka.
- **Skanna en gång per dygn, inte oftare.** Program ändras i dagsskala. Tätare
  svep belastar scenernas sidor utan att göra listan bättre.

## 10. Öppna beslut

- **Namnet.** `kulturkalender` är valt som arbetsnamn i `package.json` och
  dokumentationen. Repot heter fortfarande `receptbok` och adressen är
  `receptbok.pages.dev`. Båda behöver döpas om – i GitHub och i Cloudflare, inte
  i koden.
- **Supabase.** `db/drop-receptbok.sql` finns men är inte körd. Receptbokens
  tabeller ligger kvar i projektet. **Exportera recepten först** – de är inmatade
  för hand och går inte att skanna fram igen.
- **Geografi.** `venues.lat/lng` finns i schemat men fylls inte av något. Kartvy
  eller "nära mig" är inte beslutat, kolumnerna är bara billiga att ha.
- **Hur långt fram listan sträcker sig.** Utställningar pågår i månader,
  konserter är ett kvällsdatum. `upcoming_events` visar allt framåt utan tak,
  vilket gör att en utställning kan ligga kvar högst upp i veckor.

- **Speltid kontra föreställning.** Kulturhuset publicerar en pjäs som *ett*
  Event med `startDate` på premiären och `endDate` på derniären – "Amadeus"
  blir en rad med 13 september, trots att den spelas till 8 november. En
  konsert är däremot ett kvällsdatum. Listan blandar alltså två sorters rader
  utan att säga vilken som är vilken. Att visa "spelas 13 sep – 8 nov" när
  `ends_at` ligger mer än ett dygn efter `starts_at` skulle lösa det, och
  datan finns redan. Inte byggt.

## 11. Uppsättning: fällor vi redan gått i

Från leasing- och receptprojektens uppsättningar. Läs **före** nästa uppsättning.

1. **Supabases nya `sb_secret_`-nycklar fungerade inte** mot Data API:t – allt gav
   401 med tom svarskropp. Legacy `service_role` (`eyJ…`) fungerade direkt.
2. **`SUPABASE_URL` ska vara enbart roten**, `https://<ref>.supabase.co`, utan
   `/rest/v1/`. Koden lägger till sökvägen.
3. **Explicita cast i räknande vyer.** `percentile_cont` returnerar
   `double precision` även för `numeric`, och `date_part` likaså – `round(…, 1)`
   kraschar på båda. `upcoming_events.days_until` castar därför uttryckligen.
4. **Google Drive låser `.git`** mitt under operationer. Vid
   `could not lock config file`: ta bort `.git/*.lock` när ingen git-process kör.
5. **Verifiera i molnet tidigt.** Kör en `workflow_dispatch` innan något byggs
   vidare på – moln-IP och lokal uppkoppling beter sig olika mot andras sajter.
   Det gäller dubbelt här: en scen som svarar från din hemuppkoppling kan blocka
   GitHubs IP-intervall.
6. **`npm run scan:dry` tar en flagga, inte en miljövariabel.** `DRY_RUN=1 node …`
   är inte giltig syntax i npm-scripts på Windows, där npm kör genom `cmd`.

-- Kulturkalender – schema för Supabase (Postgres).
-- Kör i Supabase SQL Editor. Skriptet är idempotent och ska alltid gå att köra om.
--
-- Fas 1 i docs/projektstart.md: scener, evenemang och driftlogg. Adaptrarna som
-- fyller tabellerna är fas 2–4 och kräver inga schemaändringar.
--
-- Säkerhetsmodellen är omvänd mot receptbokens, och det är värt att säga rakt ut:
-- här finns ingen inloggning och ingen privat data. Alla får läsa allt. Ingen får
-- skriva något – skannern skriver med service-nyckeln, som går förbi RLS och bara
-- finns i GitHub Actions-secrets. Att det stämmer bevisas av db/rls-test.sql, som
-- försöker skriva som anon och ska nekas.
--
-- Ordningen i filen är inte fri: tabellerna måste komma före vyer och policyer.
-- En funktion med `language sql` får sin kropp analyserad redan vid create, så
-- tabellen den läser måste finnas då (42P01 annars).

-- ---------------------------------------------------------------------------
-- Hjälpare utan tabellberoenden
-- ---------------------------------------------------------------------------

-- Håller updated_at aktuell utan att applikationen behöver tänka på det.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabeller
-- ---------------------------------------------------------------------------

-- Scenerna. Fylls för hand, inte av skannern: det finns ett trettiotal i
-- Stockholm som spelar roll, de byter inte namn, och en handskriven rad ger
-- en läsbar adress och en riktig position i stället för det källan råkar skriva.
create table if not exists public.venues (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name       text not null check (length(btrim(name)) > 0),
  url        text,
  address    text,
  lat        numeric(9, 6),
  lng        numeric(9, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Evenemangen.
--
-- raw sparas alltid, även när tolkningen lyckas. Samma princip som raw_text i
-- receptboken och raw i leasingens listings: tolkningen kan förbättras i
-- efterhand utan att något behöver skannas om, och när parsern har fel syns
-- originalet bredvid resultatet.
--
-- venue_raw är det källan skrev, venue_id är den scen vi kopplat det till.
-- Båda finns kvar: kopplingen är en gissning som kan bli fel, och då ska
-- originalet gå att läsa.
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  external_id   text not null,
  url           text,

  title         text not null check (length(btrim(title)) > 0),
  description   text,
  image_url     text,
  category      text not null default 'övrigt',
  genre         text,

  venue_id      uuid references public.venues(id) on delete set null,
  venue_raw     text,
  address       text,

  starts_at     timestamptz not null,
  ends_at       timestamptz,

  price_min     numeric(10, 2),
  price_max     numeric(10, 2),
  currency      text default 'SEK',
  ticket_url    text,

  status        text not null default 'scheduled',
  raw           jsonb,

  -- first_seen_at sätts en gång och rörs aldrig av upserten. last_seen_at
  -- skrivs vid varje körning där källan fortfarande listar evenemanget.
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint events_source_external_key unique (source, external_id),
  constraint events_status_check check (
    status in ('scheduled', 'cancelled', 'postponed', 'rescheduled', 'moved-online')
  ),
  constraint events_slutar_efter_start check (ends_at is null or ends_at >= starts_at)
);

-- Separat alter, inte en kolumn i create table ovan: tabellen kan redan finnas,
-- och `create table if not exists` lägger inte till kolumner i en befintlig.
-- Samma mönster som receptboken använde när ingredienstolkningen tillkom.
--
-- organizer är arrangören som källan anger den – "Kulturhuset Stadsteatern".
-- Den fyllde inget syfte förrän vyn behövde visa huset, och saknades därför
-- i tabellen trots att lib/event.mjs alltid returnerat den. En skarp körning
-- hade gett 400 från PostgREST på en okänd kolumn.
alter table public.events add column if not exists organizer text;

-- premiere_at: när uppsättningen hade premiär, inte när nästa föreställning
-- är. Två olika saker, och skillnaden är hela poängen: en pjäs som hade
-- premiär i augusti har sin nästa föreställning i morgon.
--
-- Bara två av fyra hus ger den. Dramaten skriver "Urpremiär 26 november
-- 2026" i sin payload, och Kulturhuset publicerar en uppsättning som ett
-- Event där startDate ÄR premiären. Konserthuset har inget premiärbegrepp
-- för konserter, och Operans firstPerformanceDate visade sig vara första
-- kommande föreställningen och inte premiären - se scanner/sources/operan.mjs.
-- Kolumnen är därför null oftare än den är satt, och det är sant.
alter table public.events
  add column if not exists premiere_at timestamptz;

-- Listan sorteras alltid på starttid och filtreras oftast på kategori.
create index if not exists events_starts_at_idx on public.events (starts_at);
create index if not exists events_source_starts_idx on public.events (source, starts_at);
create index if not exists events_category_starts_idx on public.events (category, starts_at);
create index if not exists events_venue_idx on public.events (venue_id);

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

drop trigger if exists venues_touch_updated_at on public.venues;
create trigger venues_touch_updated_at
  before update on public.venues
  for each row execute function public.touch_updated_at();

-- scan_runs: driftlogg per körning och källa. Gör trasiga källor synliga.
--
-- Utan den är "varför slutade Dramaten dyka upp?" en fråga man bara kan gissa
-- svaret på. Tabellen är läsbar för alla med flit – det är driftdata, inte
-- hemligheter, och en publik statussida ska kunna visa den.
create table if not exists public.scan_runs (
  id           bigint generated always as identity primary key,
  source       text not null,
  status       text not null default 'running',
  rows_found   integer not null default 0,
  rows_upserted integer not null default 0,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  constraint scan_runs_status_check check (status in ('running', 'ok', 'empty', 'error'))
);

create index if not exists scan_runs_source_started_idx
  on public.scan_runs (source, started_at desc);

-- Recensionerna, matchade mot en uppsättning. Se avsnitt 7b i
-- docs/projektstart.md.
--
-- Bara det som står i tidningens flöde: rubrik, ingress, datum och länk.
-- Kritikerns brödtext sparas aldrig - den är hennes verk, inte vår data.
--
-- Tabellen finns för att flödena glömmer. De bär ett par hundra poster, och en
-- recension är borta ur dem inom någon vecka - långt innan uppsättningen har
-- slutat spelas. Matchades de vid förfrågan, som först, försvann recensionen
-- från sidan medan pjäsen den handlar om fortfarande gick.
--
-- production_title, venue_slug och category är en ögonblicksbild från
-- matchningen. En uppsättning som spelat klart försvinner ur
-- upcoming_productions, men recensionen av den är fortfarande en recension av
-- något bestämt - och ska gå att hitta med scen- och kategorifiltret.
create table if not exists public.reviews (
  url              text primary key check (url ~ '^https://'),
  publisher        text not null,
  title            text,
  description      text,
  published_at     timestamptz,
  production_key   text not null,
  production_title text,
  venue_slug       text,
  confidence       text not null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  constraint reviews_confidence_check check (confidence in ('hög', 'osäker'))
);

-- Tillkom efter tabellen. alter och inte en rad i create table, så att filen
-- fortsätter att gå att köra mot en databas där tabellen redan finns.
alter table public.reviews add column if not exists category text;

create index if not exists reviews_production_idx on public.reviews (production_key);
create index if not exists reviews_published_idx on public.reviews (published_at desc);

-- ---------------------------------------------------------------------------
-- Husen
-- ---------------------------------------------------------------------------

-- En rad per institution vi hämtar från. slug MÅSTE vara samma sträng som
-- adapterns id i scanner/sources/index.mjs – det är den kopplingen vyerna
-- nedan joinar på, och tests/venues.test.mjs kräver att de stämmer överens.
--
-- Fylls för hand med flit. Det är ett trettiotal hus i Stockholm som spelar
-- roll, de byter inte namn, och en handskriven rad ger ett läsbart namn och en
-- riktig position i stället för det källan råkar skriva i sin ld+json.
--
-- on conflict do update, inte do nothing: rättar man ett namn här ska det slå
-- igenom vid nästa körning av skriptet i stället för att tyst ignoreras.
insert into public.venues (slug, name, url, address, lat, lng) values
  ('kulturhuset', 'Kulturhuset Stadsteatern', 'https://kulturhusetstadsteatern.se',
   'Sergels torg, 111 57 Stockholm', 59.331700, 18.063700),
  ('dramaten',    'Dramaten', 'https://www.dramaten.se',
   'Nybroplan, 111 47 Stockholm', 59.331900, 18.077600),
  ('konserthuset', 'Konserthuset Stockholm', 'https://www.konserthuset.se',
   'Hötorget 8, 111 57 Stockholm', 59.334500, 18.063200),
  ('operan',      'Kungliga Operan', 'https://www.operan.se',
   'Gustav Adolfs torg 2, 111 52 Stockholm', 59.329700, 18.070700)
on conflict (slug) do update
  set name = excluded.name,
      url = excluded.url,
      address = excluded.address,
      lat = excluded.lat,
      lng = excluded.lng;

-- ---------------------------------------------------------------------------
-- Vyer
-- ---------------------------------------------------------------------------

-- Det sidan faktiskt visar: kommande, inte inställda, med huset ifyllt.
--
-- Två olika saker heter "scen" på svenska och blandas lätt ihop:
--   venue = huset, institutionen. "Dramaten", "Kulturhuset Stadsteatern".
--   stage = rummet i huset. "Stora scenen", "Studion, plan 1", "Galleri 3".
-- Besökaren väljer hus och hittar sedan rummet på plats, så huset är det som
-- ska stå först i listan. Rummet är precisering, inte identitet.
--
-- Joinen går på v.slug = e.source och inte på e.venue_id: en källa ÄR ett hus.
-- Det finns en adapter per institution, adapterns id är husets slug, och
-- venues-raden bär det läsbara namnet och adressen. venue_id ligger kvar för
-- den dagen ett evenemang behöver pekas till en annan plats än sin källas –
-- en gästspelsscen, en utomhusspelplats – men används inte i dag.
--
-- security_invoker gör att vyn läses med anroparens rättigheter och inte med
-- ägarens. Utan den kringgår vyn RLS på tabellerna under, vilket är ofarligt så
-- länge allt är publikt – men det är precis den sortens sak som blir en lucka
-- den dagen något inte längre är det.
-- Beroende vyer släpps först. upcoming_productions bygger på
-- upcoming_events, och Postgres vägrar släppa en vy någon annan hänger på.
-- Utan de här raderna slutade skriptet vara idempotent den dag
-- uppsättningsvyn tillkom - och det märks först när någon kör om det.
drop view if exists public.upcoming_productions;

drop view if exists public.upcoming_events;
create view public.upcoming_events
with (security_invoker = true) as
select
  e.id,
  e.source,
  e.external_id,
  e.url,
  e.title,
  e.description,
  e.image_url,
  e.category,
  e.genre,
  coalesce(hus.name, e.organizer, e.source) as venue,
  hus.slug                                  as venue_slug,
  e.venue_raw                               as stage,
  coalesce(rum.address, hus.address, e.address) as address,
  e.starts_at,
  e.ends_at,
  e.premiere_at,
  e.price_min,
  e.price_max,
  e.currency,
  e.ticket_url,
  e.status,
  -- När vi först såg raden, alltså när scenen annonserade den. Sätts en gång
  -- och rörs aldrig av upserten - se kommentaren vid kolumnen.
  e.first_seen_at,
  e.last_seen_at,
  -- Explicit cast: date_part returnerar double precision, och round(…, 0) på
  -- double finns inte i Postgres. Samma fälla som medianen i leasingprojektet.
  (date_part('day', e.starts_at - now()))::integer as days_until
from public.events e
left join public.venues hus on hus.slug = e.source
left join public.venues rum on rum.id = e.venue_id
where e.starts_at >= now() - interval '3 hours'  -- pågående räknas som kommande
  and e.status <> 'cancelled';

-- Husen med hur mycket som är på gång. Driver listan högst upp på förstasidan,
-- så att besökaren ser vilka scener sidan faktiskt bevakar – och därmed också
-- vilka den inte bevakar, vilket är minst lika ärligt.
--
-- left join, inte inner: ett hus vars adapter gått sönder ska synas med noll
-- och inte försvinna ur listan. Att tappa Dramaten helt vore ett tystare fel
-- än att visa "Dramaten 0".
drop view if exists public.venue_summary;
create view public.venue_summary
with (security_invoker = true) as
select
  v.slug,
  v.name,
  v.url,
  count(e.id)::integer as upcoming_count,
  min(e.starts_at)     as next_at,
  -- När skannern senast såg huset. Driver raden högst upp på sidan, som säger
  -- hur färska uppgifterna är. Aggregatet går över samma join som antalet:
  -- vad SQL-vyn och lib/upcoming.mjs räknar ska vara samma sak, annars visar
  -- det lokala läget en annan siffra än drift.
  max(e.last_seen_at)  as last_scan_at
from public.venues v
left join public.events e
  on e.source = v.slug
 and e.starts_at >= now() - interval '3 hours'
 and e.status <> 'cancelled'
group by v.slug, v.name, v.url;

-- Uppsättningarna, en rad per pjäs eller konsert i stället för en per kväll.
--
-- "Vad spelar Dramaten?" är en annan fråga än "vad händer i kväll?", och
-- upcoming_events kan bara svara på den andra: Amnesi ligger där som sextio
-- rader. Den här vyn slår ihop dem till en.
--
-- Nyckeln är källspecifik, och det är mätt och inte antaget. Räknat på
-- kommande rader 2026-09-20:
--
--   nyckel                Dramaten  Konserthuset  Kulturhuset  Operan
--   url                         29           297          130      20
--   slug ur external_id        443           171            7     258
--
-- url är rätt för tre av fyra hus - Dramatens 29 stämmer exakt med skannerns
-- "29 uppsättningar i repertoaren". Konserthuset ger däremot varje kväll sin
-- egen adress (.../schumanns-tredje-symfoni/20260916-1800/), så där är slugen
-- i external_id nyckeln. Titeln duger ingenstans: Dramaten ger 46 titlar på
-- 29 uppsättningar, eftersom syntolkade och skolföreställningar får egna namn.
--
-- Just därför är kortaste titeln uppsättningens namn. Husen hänger på
-- kvalificerare efter grundtiteln - "Misantropen (syntolkad)", "Biohack me
-- Relaxed Performance" - så min(title) alfabetiskt ger fel svar medan den
-- kortaste ger rätt.
drop view if exists public.upcoming_productions;
create view public.upcoming_productions
with (security_invoker = true) as
with nycklade as (
  select
    e.*,
    case
      when e.source = 'konserthuset'
        then e.source || '|' || split_part(e.external_id, '/', 1)
      else e.source || '|' || coalesce(e.url, e.title)
    end as production_key
  from public.upcoming_events e
)
select
  production_key,
  source,
  min(venue)      as venue,
  min(venue_slug) as venue_slug,
  -- Kortaste titeln, se resonemanget ovan. Alfabetisk ordning som andra
  -- nyckel, så att vyn är deterministisk när två titlar är lika långa.
  (array_agg(title order by length(title), title))[1] as title,
  -- Adressen till den tidigaste föreställningen. För Konserthuset pekar den
  -- på ett datum, vilket är det närmaste huset har till en uppsättningssida.
  (array_agg(url order by starts_at))[1] as url,
  -- Bild och text: ta från en rad som faktiskt har dem.
  (array_agg(image_url order by (image_url is null), starts_at))[1] as image_url,
  (array_agg(description order by (description is null), length(description) desc))[1] as description,
  (array_agg(category order by starts_at))[1] as category,
  (array_agg(genre order by (genre is null), starts_at))[1] as genre,
  count(*)::integer as performances,
  -- Premiären kommer från raderna, inte från min(starts_at): för en pjäs som
  -- redan spelat är de olika datum, och det är premiären en recension hör till.
  min(premiere_at) as premiere_at,
  min(starts_at)  as first_at,
  max(starts_at)  as last_at,
  min(price_min)  as price_min,
  max(price_max)  as price_max,
  -- Antal rum uppsättningen spelas i. Fler än ett betyder att den turnerar
  -- inom huset, vilket är värt att visa.
  count(distinct stage) filter (where stage is not null)::integer as stages,
  max(last_seen_at) as last_seen_at,
  -- Annonserad: när den första av uppsättningens rader dök upp hos oss. Det
  -- är så nära "scenen berättade om den" vi kommer utan att läsa deras
  -- pressmeddelanden, och det kräver ingen ny källa.
  min(first_seen_at) as announced_at
from nycklade
group by production_key, source;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.venues    enable row level security;
alter table public.events    enable row level security;
alter table public.scan_runs enable row level security;
alter table public.reviews   enable row level security;

-- Policyer skrivs om vid varje körning, så skriptet förblir idempotent.
--
-- Det finns med flit INGEN policy för insert, update eller delete på någon
-- tabell. Med RLS påslaget och ingen skrivpolicy nekas varje skrivning från
-- anon och authenticated. Skannerns service-nyckel går förbi RLS helt och
-- berörs inte. Att lägga till en skrivpolicy "tills vidare" är det enda sättet
-- att öppna sidan för sabotage – gör det inte.

drop policy if exists "scener är läsbara för alla" on public.venues;
create policy "scener är läsbara för alla"
  on public.venues for select
  using (true);

drop policy if exists "evenemang är läsbara för alla" on public.events;
create policy "evenemang är läsbara för alla"
  on public.events for select
  using (true);

drop policy if exists "driftloggen är läsbar för alla" on public.scan_runs;
create policy "driftloggen är läsbar för alla"
  on public.scan_runs for select
  using (true);

drop policy if exists "recensionerna är läsbara för alla" on public.reviews;
create policy "recensionerna är läsbara för alla"
  on public.reviews for select
  using (true);

-- ---------------------------------------------------------------------------
-- Rättigheter
-- ---------------------------------------------------------------------------

-- Grants och RLS är två olika spärrar och båda behövs: grant släpper in rollen
-- till tabellen, policyn avgör vilka rader den ser. Utan select-grant får anon
-- ett "permission denied" innan policyn ens körs.
grant usage on schema public to anon, authenticated;
grant select on public.venues, public.events, public.scan_runs, public.reviews to anon, authenticated;
grant select on public.upcoming_events, public.venue_summary to anon, authenticated;
grant select on public.upcoming_productions to anon, authenticated;

-- Ingen av rollerna får skriva. Uttalat, inte underförstått.
revoke insert, update, delete on public.venues    from anon, authenticated;
revoke insert, update, delete on public.events    from anon, authenticated;
revoke insert, update, delete on public.scan_runs from anon, authenticated;
revoke insert, update, delete on public.reviews   from anon, authenticated;

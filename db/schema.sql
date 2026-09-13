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

-- Listan sorteras alltid på starttid och filtreras oftast på kategori.
create index if not exists events_starts_at_idx on public.events (starts_at);
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

-- ---------------------------------------------------------------------------
-- Vyer
-- ---------------------------------------------------------------------------

-- Det sidan faktiskt visar: kommande, inte inställda, med scenens namn ifyllt.
--
-- security_invoker gör att vyn läses med anroparens rättigheter och inte med
-- ägarens. Utan den kringgår vyn RLS på tabellerna under, vilket är ofarligt så
-- länge allt är publikt – men det är precis den sortens sak som blir en lucka
-- den dagen något inte längre är det.
drop view if exists public.upcoming_events;
create view public.upcoming_events
with (security_invoker = true) as
select
  e.id,
  e.source,
  e.url,
  e.title,
  e.description,
  e.image_url,
  e.category,
  e.genre,
  coalesce(v.name, e.venue_raw) as venue,
  v.slug                        as venue_slug,
  coalesce(v.address, e.address) as address,
  e.starts_at,
  e.ends_at,
  e.price_min,
  e.price_max,
  e.currency,
  e.ticket_url,
  e.status,
  e.last_seen_at,
  -- Explicit cast: date_part returnerar double precision, och round(…, 0) på
  -- double finns inte i Postgres. Samma fälla som medianen i leasingprojektet.
  (date_part('day', e.starts_at - now()))::integer as days_until
from public.events e
left join public.venues v on v.id = e.venue_id
where e.starts_at >= now() - interval '3 hours'  -- pågående räknas som kommande
  and e.status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.venues    enable row level security;
alter table public.events    enable row level security;
alter table public.scan_runs enable row level security;

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

-- ---------------------------------------------------------------------------
-- Rättigheter
-- ---------------------------------------------------------------------------

-- Grants och RLS är två olika spärrar och båda behövs: grant släpper in rollen
-- till tabellen, policyn avgör vilka rader den ser. Utan select-grant får anon
-- ett "permission denied" innan policyn ens körs.
grant usage on schema public to anon, authenticated;
grant select on public.venues, public.events, public.scan_runs to anon, authenticated;
grant select on public.upcoming_events to anon, authenticated;

-- Ingen av rollerna får skriva. Uttalat, inte underförstått.
revoke insert, update, delete on public.venues    from anon, authenticated;
revoke insert, update, delete on public.events    from anon, authenticated;
revoke insert, update, delete on public.scan_runs from anon, authenticated;

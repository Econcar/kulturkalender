-- RLS-test för kulturkalendern.
--
-- Kör i Supabase SQL Editor efter db/schema.sql. Skriptet rullar tillbaka sig
-- självt och lämnar inga spår – det går att köra mot en databas med innehåll.
--
-- Receptbokens RLS-test bevisade att ett hushåll inte ser ett annats. Den här
-- sidan har ingen privat data alls, så frågan är den omvända och lika viktig:
-- kan vem som helst läsa allt, och kan ingen skriva något?
--
-- Den andra halvan är den som betyder något. Sidan har ingen inloggning, vilket
-- betyder att anon-nyckeln ligger öppet i public/config.js där den ska ligga.
-- Vem som helst kan alltså ta den och tala direkt med PostgREST. Det enda som
-- står mellan den nyckeln och vår databas är att det inte finns någon
-- skrivpolicy. Det är värt att bevisa och inte anta.
--
-- Väntat slut: "RLS-testet gick igenom".

begin;

-- ---------------------------------------------------------------------------
-- Förberedelse: två rader att läsa, skapade som ägare
-- ---------------------------------------------------------------------------

insert into public.venues (slug, name, url, address)
values ('rls-testscen', 'RLS-testscenen', 'https://exempel.se', 'Testgatan 1, Stockholm');

insert into public.events (source, external_id, title, category, venue_raw, starts_at)
values ('rls-test', 'rls-1', 'RLS-testevenemanget', 'konsert', 'RLS-testscenen',
        now() + interval '7 days');

insert into public.scan_runs (source, status, rows_found, rows_upserted)
values ('rls-test', 'ok', 1, 1);

-- ---------------------------------------------------------------------------
-- Del 1: anon ska kunna läsa
-- ---------------------------------------------------------------------------

set local role anon;

do $$
declare
  n integer;
begin
  select count(*) into n from public.events where source = 'rls-test';
  if n <> 1 then
    raise exception 'FEL: anon såg % rader i events, väntade 1', n;
  end if;

  select count(*) into n from public.venues where slug = 'rls-testscen';
  if n <> 1 then
    raise exception 'FEL: anon såg % rader i venues, väntade 1', n;
  end if;

  select count(*) into n from public.scan_runs where source = 'rls-test';
  if n <> 1 then
    raise exception 'FEL: anon såg % rader i scan_runs, väntade 1', n;
  end if;

  -- Vyn är sidans faktiska ingång. Går tabellen att läsa men inte vyn står
  -- sidan tom medan SQL-editorn visar rader, och felet ser ut som ett nätfel.
  select count(*) into n from public.upcoming_events where title = 'RLS-testevenemanget';
  if n <> 1 then
    raise exception 'FEL: anon såg % rader i upcoming_events, väntade 1', n;
  end if;

  raise notice 'OK: anon kan läsa events, venues, scan_runs och upcoming_events';
end;
$$;

-- ---------------------------------------------------------------------------
-- Del 2: anon ska INTE kunna skriva
-- ---------------------------------------------------------------------------

-- Varje försök ska sluta i insufficient_privilege (42501). Går något igenom
-- höjs ett fel som fäller hela skriptet – ett tyst godkännande är värdelöst.
do $$
declare
  nekade integer := 0;
begin
  begin
    insert into public.events (source, external_id, title, category, starts_at)
    values ('angripare', 'x-1', 'Skräprad', 'konsert', now());
    raise exception 'FEL: anon kunde INSERTa i events';
  exception
    when insufficient_privilege then nekade := nekade + 1;
  end;

  begin
    update public.events set title = 'Kapad' where source = 'rls-test';
    if not found then
      raise exception 'FEL: anon fick köra UPDATE mot events (0 rader, men inget nekande)';
    end if;
    raise exception 'FEL: anon kunde UPDATEa events';
  exception
    when insufficient_privilege then nekade := nekade + 1;
  end;

  begin
    delete from public.events where source = 'rls-test';
    if not found then
      raise exception 'FEL: anon fick köra DELETE mot events (0 rader, men inget nekande)';
    end if;
    raise exception 'FEL: anon kunde DELETEa ur events';
  exception
    when insufficient_privilege then nekade := nekade + 1;
  end;

  begin
    insert into public.venues (slug, name) values ('angripare', 'Skräpscen');
    raise exception 'FEL: anon kunde INSERTa i venues';
  exception
    when insufficient_privilege then nekade := nekade + 1;
  end;

  begin
    insert into public.scan_runs (source, status) values ('angripare', 'ok');
    raise exception 'FEL: anon kunde INSERTa i scan_runs';
  exception
    when insufficient_privilege then nekade := nekade + 1;
  end;

  if nekade <> 5 then
    raise exception 'FEL: bara % av 5 skrivförsök nekades', nekade;
  end if;

  raise notice 'OK: alla 5 skrivförsök från anon nekades';
end;
$$;

-- ---------------------------------------------------------------------------
-- Del 3: samma sak för authenticated
-- ---------------------------------------------------------------------------

-- Rollen används inte i dag – sidan har ingen inloggning. Testet finns ändå,
-- för den dagen någon lägger till inloggning för att kunna spara favoriter.
-- Då ska det synas direkt om den rollen råkade få skrivrätt på köpet.
set local role authenticated;

do $$
declare
  n integer;
begin
  select count(*) into n from public.events where source = 'rls-test';
  if n <> 1 then
    raise exception 'FEL: authenticated såg % rader i events, väntade 1', n;
  end if;

  begin
    insert into public.events (source, external_id, title, category, starts_at)
    values ('angripare', 'x-2', 'Skräprad', 'konsert', now());
    raise exception 'FEL: authenticated kunde INSERTa i events';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'OK: authenticated kan läsa men inte skriva';
end;
$$;

reset role;

-- ---------------------------------------------------------------------------

do $$
begin
  raise notice '---';
  raise notice 'RLS-testet gick igenom';
end;
$$;

rollback;

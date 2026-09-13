-- Engångsstädning: tar bort receptbokens tabeller ur det återanvända
-- Supabase-projektet, så att kulturkalendern börjar i en ren databas.
--
-- KÖRS EN GÅNG, MEDVETET. Det här raderar data på riktigt och går inte att
-- ångra. Schemat finns kvar i git (`git show 7d3effc:db/schema.sql`), men
-- recepten som samlats in gör det inte – och till skillnad från leasingens
-- annonser går de inte att skanna fram igen. De är inmatade för hand.
--
-- EXPORTERA FÖRST. Table Editor → recipes → Export → CSV, och samma för
-- recipe_ingredients. Det tar två minuter och är enda vägen tillbaka.
--
-- touch_updated_at lämnas kvar med flit – kulturkalenderns schema återanvänder den.
--
-- Kör db/schema.sql efter det här.

begin;

-- Barnen först: främmande nycklar blockerar annars droppen.
drop table if exists public.meal_plan_items;
drop table if exists public.shopping_list_items;
drop table if exists public.meal_plan;
drop table if exists public.recipe_tags;
drop table if exists public.recipe_ingredients;
drop table if exists public.household_invites;
drop table if exists public.ingredients;
drop table if exists public.tags;
drop table if exists public.recipes;
drop table if exists public.household_members;
drop table if exists public.households;

-- Funktionerna hushållsmodellen hängde på. touch_updated_at är INTE med här –
-- det nya schemat använder den.
drop function if exists public.redeem_household_invite(uuid);
drop function if exists public.add_creator_as_owner();
drop function if exists public.is_plan_in_my_household(uuid);
drop function if exists public.is_recipe_in_my_household(uuid);
drop function if exists public.is_household_owner(uuid);
drop function if exists public.is_household_member(uuid);

commit;

-- Kontroll: ska ge noll rader.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'households', 'household_members', 'household_invites',
    'recipes', 'recipe_ingredients', 'recipe_tags', 'tags', 'ingredients',
    'meal_plan', 'meal_plan_items', 'shopping_list_items'
  );

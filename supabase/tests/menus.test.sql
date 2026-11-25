-- pgTAP tests for the menus: who can read which menu, who can change them, what a saved menu
-- may hold, and how the version guards against one save overwriting another.
-- Run with `supabase test db`. Everything is rolled back at the end.
begin;

create extension if not exists pgtap;
select no_plan();

-- People ------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000001', 'owner@example.com',    now()),
  ('00000000-0000-4000-8000-000000000003', 'stranger@example.com', now());
insert into private.owners (user_id) values ('00000000-0000-4000-8000-000000000001');

create function pg_temp.claims(uid text) returns text language sql as $$
  select json_build_object('sub', uid, 'role', 'authenticated')::text
$$;
select pg_temp.claims('00000000-0000-4000-8000-000000000001') as owner \gset
select pg_temp.claims('00000000-0000-4000-8000-000000000003') as stranger \gset

select (now() at time zone 'Australia/Sydney')::date as today \gset

-- A dinner menu the owner has prepared, and one evening already past.
update public.menus set sections = '[{"title":"to share","items":[{"name":"oysters","price":"6 each"}]}]' where kind = 'dinner';
insert into public.dinner_services (service_date, first_seating, last_seating) values (:'today'::date - 7, '17:30', '20:30');

-- Structure ---------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.menus'::regclass),
  'row level security is enabled on menus');
select is((select array_agg(kind order by kind) from public.menus), array['dinner', 'lunch'],
  'there are two menus, lunch and dinner');
select ok((select jsonb_array_length(sections) > 0 from public.menus where kind = 'lunch'),
  'the lunch menu starts with the sample menu');
select ok(not has_table_privilege('anon', 'public.menus', 'update'), 'visitors hold no update right on menus');
select ok(not has_table_privilege('authenticated', 'public.menus', 'insert'), 'signed-in accounts cannot add a menu');
select ok(not has_table_privilege('authenticated', 'public.menus', 'delete'), 'signed-in accounts cannot delete a menu');
select ok(not has_column_privilege('authenticated', 'public.menus', 'version', 'update'), 'the version cannot be set by hand');
select ok(not has_column_privilege('authenticated', 'public.menus', 'kind', 'update'), 'a menu cannot be renamed');
select ok(not has_function_privilege('anon', 'private.menu_sections_valid(jsonb)', 'execute'), 'visitors cannot call the menu check');

-- Anonymous visitors ------------------------------------------------------------------------
set local role anon;
select is((select array_agg(kind) from public.menus), array['lunch'],
  'with no dinner date coming up, a visitor sees the lunch menu only');
select throws_ok($$ update public.menus set note = 'x' $$, '42501', null, 'a visitor cannot change a menu');
select throws_ok($$ insert into public.menus (kind) values ('dinner') $$, '42501', null, 'a visitor cannot add a menu');
select throws_ok($$ delete from public.menus $$, '42501', null, 'a visitor cannot delete a menu');
reset role;

-- A signed-in account that is not an owner ----------------------------------------------------
select set_config('request.jwt.claims', :'stranger', true);
set local role authenticated;
select is((select array_agg(kind) from public.menus), array['lunch'],
  'a signed-in account that is not an owner sees the lunch menu only');
select lives_ok($$ update public.menus set note = 'x' $$, 'its change runs');
reset role;
select is((select count(*) from public.menus where note = 'x'), 0::bigint, '...but changes nothing');

-- Dinner tonight: the dinner menu becomes public ------------------------------------------------
insert into public.dinner_services (service_date, first_seating, last_seating) values (:'today', '17:30', '20:30');
set local role anon;
select is((select array_agg(kind order by kind) from public.menus), array['dinner', 'lunch'],
  'with a dinner date today, a visitor sees both menus');
select is((select sections -> 0 -> 'items' -> 0 ->> 'name' from public.menus where kind = 'dinner'), 'oysters',
  '...including what is on the dinner menu');
reset role;
select set_config('request.jwt.claims', :'stranger', true);
set local role authenticated;
select is((select count(*) from public.menus), 2::bigint, 'so does a signed-in account that is not an owner');
reset role;
delete from public.dinner_services where service_date = :'today';
insert into public.dinner_services (service_date, first_seating, last_seating) values (:'today'::date + 30, '17:30', '20:30');
set local role anon;
select is((select count(*) from public.menus), 2::bigint, 'a dinner date a month away shows the dinner menu too');
reset role;
delete from public.dinner_services where service_date = :'today'::date + 30;
set local role anon;
select is((select count(*) from public.menus), 1::bigint, 'and once the date is removed the dinner menu is hidden again');
reset role;

-- An owner ------------------------------------------------------------------------------------
select set_config('request.jwt.claims', :'owner', true);
set local role authenticated;
select is((select count(*) from public.menus), 2::bigint, 'an owner sees both menus with no dinner date coming up');
select is((select version from public.menus where kind = 'lunch'), 1, 'the lunch menu starts at version 1');

select results_eq(
  $$ update public.menus set note = 'Changes with the season.',
       sections = '[{"title":"plates","items":[{"name":"fish burger","desc":"pickle, mustard","price":"19"},{"name":"canelé"}]},{"title":"","items":[]}]'
     where kind = 'lunch' and version = 1 returning version $$,
  $$ values (2) $$,
  'an owner can save a menu, and the version goes up by one');
select is((select note from public.menus where kind = 'lunch'), 'Changes with the season.', 'the note is saved');
select is((select sections -> 0 -> 'items' -> 1 ->> 'name' from public.menus where kind = 'lunch'), 'canelé', 'the items are saved in order');
-- Exactly this transaction's time: only a stamp made by this save can equal it.
select is((select updated_at from public.menus where kind = 'lunch'), now(), 'the save is timestamped');

-- A second device still holding version 1 cannot overwrite the newer menu.
select is_empty(
  $$ update public.menus set note = 'older copy' where kind = 'lunch' and version = 1 returning version $$,
  'a save that started from an older version changes nothing');
select is((select note from public.menus where kind = 'lunch'), 'Changes with the season.', '...and the newer menu stands');

select throws_ok($$ update public.menus set version = 99 where kind = 'lunch' $$, '42501', null, 'an owner cannot set the version by hand');
select throws_ok($$ update public.menus set kind = 'dinner' where kind = 'lunch' $$, '42501', null, 'an owner cannot rename a menu');
select throws_ok($$ update public.menus set updated_at = now() - interval '1 year' where kind = 'lunch' $$, '42501', null, 'an owner cannot backdate a save');
select throws_ok($$ insert into public.menus (kind) values ('brunch') $$, '42501', null, 'an owner cannot add a third menu');
select throws_ok($$ delete from public.menus where kind = 'dinner' $$, '42501', null, 'an owner cannot delete a menu');

-- What a menu may hold --------------------------------------------------------------------------
create function pg_temp.saves(sections text) returns boolean language plpgsql as $$
begin
  update public.menus set sections = saves.sections::jsonb where kind = 'dinner';
  return true;
exception when check_violation then
  return false;
end $$;

select ok(pg_temp.saves('[]'), 'an empty menu is accepted');
select ok(pg_temp.saves('[{"title":"","items":[]}]'), 'a section may have no title and no items');
select ok(pg_temp.saves('[{"title":"x","items":[{"name":"a"}]}]'), 'an item needs only a name');
select ok(pg_temp.saves((select jsonb_agg(jsonb_build_object('title', repeat('t', 40), 'items',
    (select jsonb_agg(jsonb_build_object('name', repeat('n', 80), 'desc', repeat('d', 200), 'price', repeat('p', 24))) from generate_series(1, 40))))
  from generate_series(1, 12))::text), 'the largest allowed menu is accepted: 12 sections of 40 items, every field full');

select ok(not pg_temp.saves('{"title":"x","items":[]}'), 'a menu must be a list');
select ok(not pg_temp.saves('"soup"'), 'a menu cannot be a piece of text');
select ok(not pg_temp.saves('null'), 'a menu cannot be a JSON null');
select ok(not pg_temp.saves((select jsonb_agg(jsonb_build_object('title', 'x', 'items', '[]'::jsonb)) from generate_series(1, 13))::text),
  'no more than 12 sections');
select ok(not pg_temp.saves(jsonb_build_array(jsonb_build_object('title', 'x', 'items',
    (select jsonb_agg(jsonb_build_object('name', 'a')) from generate_series(1, 41))))::text), 'no more than 40 items in a section');
select ok(not pg_temp.saves('["soup"]'), 'a section must be an object');
select ok(not pg_temp.saves('[{"items":[]}]'), 'a section needs a title, even an empty one');
select ok(not pg_temp.saves('[{"title":"x"}]'), 'a section needs an item list');
select ok(not pg_temp.saves('[{"title":7,"items":[]}]'), 'a title must be text');
select ok(not pg_temp.saves('[{"title":"x","items":{}}]'), 'the items must be a list');
select ok(not pg_temp.saves(jsonb_build_array(jsonb_build_object('title', repeat('t', 41), 'items', '[]'::jsonb))::text), 'a title over 40 characters is refused');
select ok(not pg_temp.saves('[{"title":"x","items":[],"hidden":true}]'), 'a section holds nothing but a title and items');
select ok(not pg_temp.saves('[{"title":"x","items":["soup"]}]'), 'an item must be an object');
select ok(not pg_temp.saves('[{"title":"x","items":[{}]}]'), 'an item needs a name');
select ok(not pg_temp.saves('[{"title":"x","items":[{"name":"   "}]}]'), 'a name of spaces is not a name');
select ok(not pg_temp.saves('[{"title":"x","items":[{"name":null}]}]'), 'a name cannot be null');
select ok(not pg_temp.saves('[{"title":"x","items":[{"name":12}]}]'), 'a name must be text');
select ok(not pg_temp.saves(jsonb_build_array(jsonb_build_object('title', 'x', 'items', jsonb_build_array(jsonb_build_object('name', repeat('n', 81)))))::text), 'a name over 80 characters is refused');
select ok(not pg_temp.saves(jsonb_build_array(jsonb_build_object('title', 'x', 'items', jsonb_build_array(jsonb_build_object('name', 'a', 'desc', repeat('d', 201)))))::text), 'a description over 200 characters is refused');
select ok(not pg_temp.saves(jsonb_build_array(jsonb_build_object('title', 'x', 'items', jsonb_build_array(jsonb_build_object('name', 'a', 'price', repeat('p', 25)))))::text), 'a price over 24 characters is refused');
select ok(not pg_temp.saves('[{"title":"x","items":[{"name":"a","price":19}]}]'), 'a price must be text, so "19" not 19');
select ok(not pg_temp.saves('[{"title":"x","items":[{"name":"a","desc":null}]}]'), 'a description is text or absent, not null');
select ok(not pg_temp.saves('[{"title":"x","items":[{"name":"a","html":"<b>"}]}]'), 'an item holds nothing but name, desc and price');

select throws_ok(format($$ update public.menus set note = %L where kind = 'dinner' $$, repeat('n', 201)), '23514', null, 'a note over 200 characters is refused');
select lives_ok(format($$ update public.menus set note = %L where kind = 'dinner' $$, repeat('n', 200)), 'a note of 200 characters is accepted');
select throws_ok($$ update public.menus set note = null where kind = 'dinner' $$, '23502', null, 'a note cannot be null');
reset role;

-- The service role (dashboard, backups) --------------------------------------------------------
set local role service_role;
select lives_ok($$ update public.menus set note = '' where kind = 'dinner' $$, 'the service role can change a menu');
reset role;

-- An owner taken off the list loses the right to save -------------------------------------------
delete from private.owners where user_id = '00000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', :'owner', true);
set local role authenticated;
select is_empty($$ update public.menus set note = 'after removal' where kind = 'lunch' returning version $$,
  'a removed owner can no longer save a menu');
select is((select array_agg(kind) from public.menus), array['lunch'], '...nor see the dinner menu');
reset role;

-- Nothing to infer from the planner -----------------------------------------------------------
-- A planned row count is an estimate made from column statistics, which cover hidden rows too.
-- After a fresh ANALYZE there must be none for anything a hidden dinner menu holds.
analyze public.menus;
select is((select count(*) from pg_stats where schemaname = 'public' and tablename = 'menus' and attname <> 'kind'), 0::bigint,
  'no column statistics exist for a menu''s note, sections, version or save time');
select ok((select bool_and(coalesce(attstattarget, -1) = 0) from pg_attribute
           where attrelid = 'public.menus'::regclass and attname in ('note', 'sections', 'version', 'updated_at')),
  'those four columns have statistics switched off');

select * from finish();
rollback;

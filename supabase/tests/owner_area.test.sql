-- pgTAP tests for the owner area: who is an owner, and what owners, other signed-in
-- accounts and anonymous visitors can each do with reservations, photos and photo files.
-- Run with `supabase test db`. Everything is rolled back at the end.
begin;

create extension if not exists pgtap;
select no_plan();

-- Lets the suite delete rows from storage.objects directly, as the Storage API does itself.
-- (Supabase blocks direct deletes from that table unless this is set.)
select set_config('storage.allow_delete_query', 'true', true);

-- People ------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000001', 'owner@example.com',    now()),  -- on the owner list
  ('00000000-0000-4000-8000-000000000002', 'former@example.com',   now()),  -- on the list, then deleted
  ('00000000-0000-4000-8000-000000000003', 'stranger@example.com', now());  -- not on the list
insert into private.owners (user_id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

-- Signs in as the given account, the way the Data API and Storage do for a request.
create function pg_temp.claims(uid text) returns text language sql as $$
  select json_build_object('sub', uid, 'role', 'authenticated')::text
$$;
select pg_temp.claims('00000000-0000-4000-8000-000000000001') as owner \gset
select pg_temp.claims('00000000-0000-4000-8000-000000000002') as former \gset
select pg_temp.claims('00000000-0000-4000-8000-000000000004') as lookalike \gset
select pg_temp.claims('00000000-0000-4000-8000-000000000003') as stranger \gset

-- Data --------------------------------------------------------------------------------------
select (now() at time zone 'Australia/Sydney')::date + 7 as day \gset
insert into public.reservations (reservation_date, reservation_time, party_size, name, email)
values (:'day', '10:30', 2, 'Ada Lovelace', 'ada@example.com'),
       (:'day', '11:00', 4, 'Grace Hopper', 'grace@example.com');
insert into public.photos (path, alt, sort_order) values ('first.jpg', 'Coffee on the counter', 1);
insert into public.dinner_services (service_date, first_seating, last_seating) values
  (:'day'::date - 14, '17:30', '20:30'),  -- an evening already past
  (:'day',            '17:30', '20:30');
insert into storage.buckets (id, name, public) values ('elsewhere', 'elsewhere', false);
insert into storage.objects (bucket_id, name) values ('photos', 'first.jpg'), ('elsewhere', 'private.pdf');

-- Structure ---------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.photos'::regclass),
  'row level security is enabled on photos');
select ok((select public from storage.buckets where id = 'photos'), 'the photos bucket is public');
select ok(not has_table_privilege('authenticated', 'private.owners', 'select'),
  'signed-in accounts cannot read the owner list');
select ok(not has_table_privilege('anon', 'private.owners', 'select'),
  'visitors cannot read the owner list');
select ok(not has_function_privilege('anon', 'public.is_owner()', 'execute'),
  'visitors cannot call is_owner');
select ok(
  (select bool_and(attstattarget = 0) from pg_attribute
    where attrelid = 'public.reservations'::regclass and attnum > 0 and not attisdropped),
  'no column statistics are kept for reservations, so planner estimates say nothing about its contents');
select column_privs_are('public', 'reservations', 'status', 'authenticated', array['SELECT', 'UPDATE'],
  'signed-in accounts may only change the status column of a reservation');
select column_privs_are('public', 'reservations', 'email', 'authenticated', array['SELECT'],
  'signed-in accounts cannot edit a guest''s details');

-- Anonymous visitors ------------------------------------------------------------------------
set local role anon;
select throws_ok('select * from public.reservations', '42501', null, 'a visitor still cannot read reservations');
select is((select count(*) from public.photos), 1::bigint, 'a visitor can see the photos');
select throws_ok($$ insert into public.photos (path) values ('visitor.jpg') $$, '42501', null,
  'a visitor cannot add a photo');
select throws_ok($$ update public.photos set alt = 'x' $$, '42501', null, 'a visitor cannot edit a photo');
select throws_ok($$ delete from public.photos $$, '42501', null, 'a visitor cannot remove a photo');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('photos', 'visitor.jpg') $$,
  '42501', null, 'a visitor cannot upload a file');
select is((select count(*) from storage.objects), 0::bigint, 'a visitor cannot list files');
select throws_ok('select private.is_owner()', '42501', null, 'a visitor cannot reach the private schema');
select is((select count(*) from public.dinner_services), 1::bigint, 'a visitor sees upcoming dinner dates, not past ones');
select throws_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '18:00', '20:00') $$, :'day'::date + 1),
  '42501', null, 'a visitor cannot add a dinner date');
select throws_ok($$ update public.dinner_services set last_seating = '23:00' $$, '42501', null, 'a visitor cannot change dinner times');
select throws_ok($$ delete from public.dinner_services $$, '42501', null, 'a visitor cannot remove a dinner date');
reset role;

-- A signed-in account that is not an owner ---------------------------------------------------
select set_config('request.jwt.claims', :'stranger', true);
set local role authenticated;
select is(public.is_owner(), false, 'an unlisted account is not an owner');
select is((select count(*) from public.reservations), 0::bigint, 'it sees no reservations');
select lives_ok($$ update public.reservations set status = 'confirmed' $$, 'its update runs');
select lives_ok($$ delete from public.reservations $$, 'its delete runs');
select throws_ok($$ insert into public.photos (path) values ('stranger.jpg') $$, '42501', null,
  'it cannot add a photo');
select lives_ok($$ update public.photos set alt = 'defaced' $$, 'its photo edit runs');
select lives_ok($$ delete from public.photos $$, 'its photo delete runs');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('photos', 'stranger.jpg') $$,
  '42501', null, 'it cannot upload a file');
select is((select count(*) from storage.objects), 0::bigint, 'it cannot list files');
select lives_ok($$ delete from storage.objects $$, 'its file delete runs');
select is((select count(*) from public.dinner_services), 1::bigint, 'it sees upcoming dinner dates only');
select throws_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '18:00', '20:00') $$, :'day'::date + 1),
  '42501', null, 'it cannot add a dinner date');
select lives_ok($$ update public.dinner_services set last_seating = '23:00' $$, 'its dinner-time change runs');
select lives_ok($$ delete from public.dinner_services $$, 'its dinner-date delete runs');
select throws_ok('select * from private.owners', '42501', null, 'it cannot read the owner list');
select throws_ok($$ insert into private.owners (user_id) values ('00000000-0000-4000-8000-000000000003') $$, '42501', null,
  'it cannot make itself an owner');
select throws_ok('select email from auth.users', '42501', null, 'it cannot read accounts');
reset role;

select is((select count(*) from public.reservations where status = 'pending'), 2::bigint,
  '...but none of that changed or removed a reservation');
select is((select alt from public.photos where path = 'first.jpg'), 'Coffee on the counter',
  '...or a photo');
select results_eq(
  $$ select count(*), max(last_seating) from public.dinner_services $$,
  $$ values (2::bigint, '20:30'::time) $$,
  '...or a dinner date');
select is((select count(*) from storage.objects where bucket_id = 'photos'), 1::bigint, '...or a file');

-- An owner whose account is deleted, and a later account with the same address ----------------
select set_config('request.jwt.claims', :'former', true);
set local role authenticated;
select is(public.is_owner(), true, 'a second listed account is an owner too');
reset role;
delete from auth.users where id = '00000000-0000-4000-8000-000000000002';
select is((select count(*) from private.owners), 1::bigint, 'deleting an account removes it from the owner list');
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000004', 'former@example.com', now());
select set_config('request.jwt.claims', :'lookalike', true);
set local role authenticated;
select is(public.is_owner(), false, 'a new account with a former owner''s address is not an owner');
select is((select count(*) from public.reservations), 0::bigint, 'and sees no reservations');
reset role;

-- An owner ----------------------------------------------------------------------------------
select set_config('request.jwt.claims', :'owner', true);
set local role authenticated;
select is(public.is_owner(), true, 'a listed account is an owner');
select is((select count(*) from public.reservations), 2::bigint, 'an owner sees every reservation');
select lives_ok($$ update public.reservations set status = 'confirmed' where email = 'ada@example.com' $$,
  'an owner can confirm a reservation');
select throws_ok($$ update public.reservations set party_size = 9 where email = 'ada@example.com' $$,
  '42501', null, 'an owner cannot rewrite a guest''s details');
select throws_ok($$ update public.reservations set status = 'maybe' where email = 'ada@example.com' $$,
  '23514', null, 'an unknown status is rejected');
select throws_ok(
  format($$ insert into public.reservations (reservation_date, reservation_time, party_size, name, email)
            values (%L, '12:00', 2, 'Owner', 'owner@example.com') $$, :'day'::date),
  '42501', null, 'the owner area does not create reservations');
select lives_ok($$ delete from public.reservations where email = 'grace@example.com' $$,
  'an owner can delete a reservation');

select lives_ok($$ insert into public.photos (path, alt, sort_order, width, height)
                   values ('second.jpg', 'The front window', 2, 1600, 1200) $$, 'an owner can add a photo');
select throws_ok($$ insert into public.photos (path) values ('../secret.jpg') $$, '23514', null,
  'a photo path cannot climb out of the bucket');
select throws_ok($$ insert into public.photos (path) values ('folder/inner.jpg') $$, '23514', null,
  'a photo path cannot contain folders');
select throws_ok($$ insert into public.photos (path) values ('first.jpg') $$, '23505', null,
  'the same file cannot be listed twice');
select throws_ok($$ insert into public.photos (path, width) values ('half.jpg', 1600) $$, '23514', null,
  'a photo cannot have a width without a height');
select lives_ok($$ update public.photos set alt = 'Flat white', sort_order = 5 where path = 'first.jpg' $$,
  'an owner can change a description and the order');
select throws_ok($$ update public.photos set path = 'other.jpg' where path = 'first.jpg' $$, '42501', null,
  'a photo cannot be pointed at a different file');
select lives_ok($$ delete from public.photos where path = 'second.jpg' $$, 'an owner can remove a photo');

select lives_ok($$ insert into storage.objects (bucket_id, name) values ('photos', 'second.jpg') $$,
  'an owner can upload a file to the photos bucket');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('elsewhere', 'second.jpg') $$,
  '42501', null, 'an owner cannot upload to another bucket');
select is((select count(*) from storage.objects), 2::bigint, 'an owner can list the photo files, and only those');
select lives_ok($$ delete from storage.objects where name = 'second.jpg' $$, 'an owner can delete a file');
select lives_ok($$ delete from storage.objects where bucket_id = 'elsewhere' $$, 'an owner''s delete in another bucket runs');
-- Dinner dates
select is((select count(*) from public.dinner_services), 2::bigint, 'an owner sees past dinner dates as well');
select lives_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '18:00', '21:00') $$, :'day'::date + 1),
  'an owner can add a dinner date');
select throws_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '18:00', '21:00') $$, :'day'::date + 1),
  '23505', null, 'the same evening cannot be added twice');
select throws_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '12:00', '14:00') $$, :'day'::date + 2),
  '23514', null, 'a dinner date cannot start before 4pm: breakfast and lunch are walk-in only');
select throws_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '20:00', '18:00') $$, :'day'::date + 2),
  '23514', null, 'the last seating cannot be before the first');
select throws_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '18:10', '20:00') $$, :'day'::date + 2),
  '23514', null, 'seating times sit on the quarter hour');
select lives_ok(format($$ update public.dinner_services set first_seating = '17:00', last_seating = '21:30' where service_date = %L $$, :'day'::date + 1),
  'an owner can change the seating times');
select throws_ok(format($$ update public.dinner_services set service_date = %L where service_date = %L $$, :'day'::date + 3, :'day'::date + 1),
  '42501', null, 'a dinner date cannot be moved, only removed and added');
select lives_ok(format($$ delete from public.dinner_services where service_date = %L $$, :'day'::date + 1),
  'an owner can remove a dinner date');

select throws_ok('select * from private.owners', '42501', null, 'an owner cannot read the owner list through the API');
select throws_ok($$ insert into private.owners (user_id) values ('00000000-0000-4000-8000-000000000003') $$, '42501', null,
  'an owner cannot add another owner through the API');
reset role;

select results_eq(
  $$ select email, status from public.reservations order by email $$,
  $$ values ('ada@example.com', 'confirmed') $$,
  'the owner''s changes are what was stored');
select is((select count(*) from storage.objects where bucket_id = 'photos'), 1::bigint,
  'the deleted file is gone');
select is((select count(*) from storage.objects where bucket_id = 'elsewhere'), 1::bigint,
  '...but the file in the other bucket was not touched');

-- Removing an owner takes effect straight away -----------------------------------------------
delete from private.owners where user_id = '00000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', :'owner', true);
set local role authenticated;
select is(public.is_owner(), false, 'a removed owner loses access at once');
select is((select count(*) from public.reservations), 0::bigint, 'and no longer sees reservations');
reset role;

select * from finish();
rollback;

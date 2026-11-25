-- pgTAP tests for public.reservations.
-- Run with `supabase test db`, or `pg_prove -d <database> supabase/tests/reservations.test.sql`.
-- Everything runs in one transaction that is rolled back, so no data is left behind.
begin;

create extension if not exists pgtap;
select no_plan();

-- Builds an INSERT exactly as the website sends it (guest columns only).
create function pg_temp.request(
  d date, t text, party int, guest text, mail text, phone text default null, notes text default null
) returns text language sql as $$
  select format(
    'insert into public.reservations (reservation_date, reservation_time, party_size, name, email, phone, notes)
     values (%L, %L, %L, %L, %L, %L, %L)', d, t, party, guest, mail, phone, notes)
$$;

select (now() at time zone 'Australia/Sydney')::date + 7 as day \gset

select pg_temp.request(:'day', '10:30', 2, 'Ada Lovelace', 'ada@example.com') as ok \gset
select pg_temp.request(:'day', '11:00', 2, '  Grace   Hopper ', ' GRACE@Example.COM ', ' 0400  000 000 ', '  window seat  ') as messy \gset
select pg_temp.request(:'day'::date - 8, '10:30', 2, 'Past', 'past@example.com') as past \gset
select pg_temp.request(:'day'::date + 400, '10:30', 2, 'Far', 'far@example.com') as far \gset
select pg_temp.request(:'day', '10:07', 2, 'Odd', 'odd@example.com') as odd_time \gset
select pg_temp.request(:'day', '10:30', 0, 'Zero', 'zero@example.com') as party_zero \gset
select pg_temp.request(:'day', '10:30', 21, 'Big', 'big@example.com') as party_big \gset
select pg_temp.request(:'day', '10:30', 2, 'Bad', 'not-an-email') as bad_email \gset
select pg_temp.request(:'day', '10:30', 2, '   ', 'blank@example.com') as blank_name \gset
select pg_temp.request(:'day', '10:30', 2, repeat('n', 101), 'long@example.com') as long_name \gset
select pg_temp.request(:'day', '10:30', 2, 'Phone', 'phone@example.com', 'call me maybe') as bad_phone \gset
select pg_temp.request(:'day', '10:30', 2, 'Notes', 'notes@example.com', null, repeat('x', 501)) as long_notes \gset
select pg_temp.request(:'day', '12:00', 2, 'Sixth', 'ada@example.com') as sixth \gset
select pg_temp.request(:'day', '13:00', 2, 'After cap', 'late@example.com') as after_cap \gset

-- Structure and grants ------------------------------------------------------------------
select has_table('public', 'reservations', 'reservations table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.reservations'::regclass),
  'row level security is enabled');
select table_privs_are('public', 'reservations', 'anon', array[]::text[],
  'anon has no table-wide privileges');
select table_privs_are('public', 'reservations', 'authenticated', array[]::text[],
  'authenticated has no privileges');
select column_privs_are('public', 'reservations', 'email', 'anon', array['INSERT'],
  'anon may only insert the guest columns');
select column_privs_are('public', 'reservations', 'status', 'anon', array[]::text[],
  'anon cannot set status');
select column_privs_are('public', 'reservations', 'id', 'anon', array[]::text[],
  'anon cannot set id');
select column_privs_are('public', 'reservations', 'created_at', 'anon', array[]::text[],
  'anon cannot set created_at');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon cannot use the private schema');
select ok(not has_function_privilege('anon', 'private.reservations_before_insert()', 'execute'),
  'anon cannot call the trigger function directly');

-- What a website visitor can do ---------------------------------------------------------
set local role anon;

select lives_ok(:'ok', 'a visitor can request a table');
select lives_ok(:'messy', 'untidy input is accepted');

select throws_ok('select * from public.reservations', '42501', null, 'a visitor cannot read requests');
select throws_ok('select count(*) from public.reservations', '42501', null, 'a visitor cannot count requests');
select throws_ok('update public.reservations set party_size = 9', '42501', null, 'a visitor cannot update');
select throws_ok('delete from public.reservations', '42501', null, 'a visitor cannot delete');
select throws_ok('truncate public.reservations', '42501', null, 'a visitor cannot truncate');
select throws_ok(
  format('insert into public.reservations (reservation_date, reservation_time, party_size, name, email, status)
          values (%L, ''10:45'', 2, ''Sneaky'', ''sneaky@example.com'', ''confirmed'')', :'day'::date),
  '42501', null, 'a visitor cannot confirm their own request');
select throws_ok(
  format('insert into public.reservations (reservation_date, reservation_time, party_size, name, email, created_at)
          values (%L, ''10:45'', 2, ''Sneaky'', ''sneaky@example.com'', ''2020-01-01'')', :'day'::date),
  '42501', null, 'a visitor cannot backdate created_at');
select throws_ok(
  :'ok' || ' returning id', '42501', null, 'a visitor cannot read a row back with RETURNING');

select throws_ok(:'past', '42501', null, 'a past date is rejected');
select throws_ok(:'far', '42501', null, 'a date more than a year ahead is rejected');
select throws_ok(:'odd_time', '23514', null, 'a time off the quarter hour is rejected');
select throws_ok(:'party_zero', '23514', null, 'a party of 0 is rejected');
select throws_ok(:'party_big', '23514', null, 'a party of 21 is rejected');
select throws_ok(:'bad_email', '23514', null, 'a malformed email is rejected');
select throws_ok(:'blank_name', '23514', null, 'a blank name is rejected');
select throws_ok(:'long_name', '23514', null, 'an over-long name is rejected');
select throws_ok(:'bad_phone', '23514', null, 'a phone number with letters is rejected');
select throws_ok(:'long_notes', '23514', null, 'over-long notes are rejected');

select lives_ok(:'ok', 'sending the same request again is accepted');

reset role;

select is(
  (select count(*) from public.reservations where email = 'ada@example.com'), 1::bigint,
  '...but is stored only once');
select results_eq(
  $$ select name, email, phone, notes, status from public.reservations where email = 'grace@example.com' $$,
  $$ values ('Grace Hopper', 'grace@example.com', '0400 000 000', 'window seat', 'pending') $$,
  'input is trimmed, the email lower-cased, and status starts as pending');

-- A declined or cancelled request does not block asking again for the same slot.
update public.reservations set status = 'cancelled' where email = 'ada@example.com';
set local role anon;
select lives_ok(:'ok', 'a guest can ask again after a cancellation');
reset role;
select is(
  (select count(*) from public.reservations where email = 'ada@example.com'), 2::bigint,
  'the new request is stored alongside the cancelled one');

-- Rate limits ---------------------------------------------------------------------------
-- Per guest: five live upcoming requests.
set local role anon;
select lives_ok(pg_temp_request, 'request ' || n || ' of 5 for one guest is accepted')
from (
  select n, format(
    'insert into public.reservations (reservation_date, reservation_time, party_size, name, email)
     values (%L, %L, 2, ''Ada Lovelace'', ''ada@example.com'')', :'day'::date + n, '09:00') as pg_temp_request
  from generate_series(1, 4) n
) s;
select throws_ok(:'sixth', 'PGRST', null, 'a sixth live request from one guest is turned away');
reset role;

-- Several rows in one request are counted one by one, and the whole request fails together.
set local role anon;
select throws_ok(
  format('insert into public.reservations (reservation_date, reservation_time, party_size, name, email)
          select %L::date + n, ''09:15'', 2, ''Bulk'', ''bulk@example.com'' from generate_series(1, 6) n', :'day'::date),
  'PGRST', null, 'six requests for one guest in a single call are turned away');
select lives_ok(
  format('insert into public.reservations (reservation_date, reservation_time, party_size, name, email)
          select %L, ''09:30'', 2, ''Twice'', ''twice@example.com'' from generate_series(1, 3) n', :'day'::date),
  'the same request repeated within a single call is accepted');
reset role;
select is(
  (select count(*) from public.reservations where email = 'bulk@example.com'), 0::bigint,
  'nothing from the rejected call is stored');
select is(
  (select count(*) from public.reservations where email = 'twice@example.com'), 1::bigint,
  'the repeated request is stored once');

-- The cafe itself is not limited and can record any booking.
select lives_ok(
  format('insert into public.reservations (reservation_date, reservation_time, party_size, name, email, status)
          select %L, ''09:00'', 2, ''Walk-in '' || n, ''guest'' || n || ''@example.com'', ''confirmed''
          from generate_series(1, 60) n', :'day'::date - 30),
  'the cafe can add many bookings, including past ones, with any status');

-- Overall: sixty requests an hour.
set local role anon;
select throws_ok(:'after_cap', 'PGRST', null, 'requests are paused once the hourly limit is reached');
reset role;

select * from finish();
rollback;

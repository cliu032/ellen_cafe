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

-- The request headers the Data API would pass on for a visitor at the given address.
create function pg_temp.visitor(address text, forwarded text default null) returns text language sql as $$
  select json_build_object('cf-connecting-ip', address, 'x-forwarded-for', coalesce(forwarded, address))::text
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
select pg_temp.request(:'day', '10:30', 0, 'Probe', 'ada@example.com') as probe \gset
select pg_temp.request(:'day', '09:15', 2, 'Fifth', 'fifth@example.com') as fifth \gset
select pg_temp.request(:'day', '12:00', 2, 'Another', 'another@example.com') as another \gset
select pg_temp.request(:'day', '12:15', 2, 'Other net', 'othernet@example.com') as other_net \gset
select pg_temp.request(:'day', '12:30', 2, 'Garbled', 'garbled@example.com') as garbled_req \gset
select pg_temp.request(:'day', '12:45', 2, 'No headers', 'noheaders@example.com') as no_headers_req \gset
select pg_temp.request(:'day', '13:00', 2, 'After cap', 'late@example.com') as after_cap \gset
select pg_temp.request(:'day', '13:15', 2, 'Tidy', 'tidy@example.com') as tidy \gset

select pg_temp.visitor('203.0.113.5') as home \gset
select pg_temp.visitor('203.0.113.5', '198.51.100.99, 203.0.113.5') as home_pretending \gset
select pg_temp.visitor('198.51.100.20') as elsewhere \gset
select pg_temp.visitor('2001:db8:1:2:aaaa::1') as v6_one \gset
select pg_temp.visitor('2001:db8:1:2:bbbb::2') as v6_same_network \gset
select pg_temp.visitor('2001:db8:1:3::1') as v6_other_network \gset
select pg_temp.visitor('not an address') as garbled \gset
select pg_temp.visitor('192.0.2.77') as late_visitor \gset

-- Structure and grants ------------------------------------------------------------------
select has_table('public', 'reservations', 'reservations table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.reservations'::regclass),
  'row level security is enabled');
select table_privs_are('public', 'reservations', 'anon', array[]::text[],
  'anon has no table-wide privileges');
select column_privs_are('public', 'reservations', 'email', 'anon', array['INSERT'],
  'anon may only insert the guest columns');
select column_privs_are('public', 'reservations', 'id', 'anon', array['INSERT'],
  'anon may supply the row id');
select column_privs_are('public', 'reservations', 'status', 'anon', array[]::text[],
  'anon cannot set status');
select column_privs_are('public', 'reservations', 'created_at', 'anon', array[]::text[],
  'anon cannot set created_at');
select ok(
  not has_table_privilege('authenticated', 'public.reservations', 'insert')
  and not has_any_column_privilege('authenticated', 'public.reservations', 'insert'),
  'signed-in accounts cannot create requests');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon cannot use the private schema');
select ok(not has_function_privilege('anon', 'private.reservations_before_insert()', 'execute'),
  'anon cannot call the trigger function directly');
select ok(not has_table_privilege('anon', 'private.reservation_log', 'select'),
  'anon cannot read the rate-limit log');

-- What a website visitor can do ---------------------------------------------------------
select set_config('request.headers', :'home', true);
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
select throws_ok('select * from private.reservation_log', '42501', null, 'a visitor cannot read the rate-limit log');

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

reset role;

select results_eq(
  $$ select name, email, phone, notes, status from public.reservations where email = 'grace@example.com' $$,
  $$ values ('Grace Hopper', 'grace@example.com', '0400 000 000', 'window seat', 'pending') $$,
  'input is trimmed, the email lower-cased, and status starts as pending');
select is((select count(*) from private.reservation_log), 2::bigint,
  'only the two stored requests were counted; rejected ones were not');

-- Replies never depend on what someone else has booked -----------------------------------
-- An invalid request must fail the same way whether or not that guest already has the slot.
set local role anon;
select throws_ok(:'probe', '23514', null,
  'an invalid request for a slot someone holds fails like any other invalid request');
select lives_ok(:'ok', 'the same guest can ask for the same slot again');
reset role;
select is((select count(*) from public.reservations where email = 'ada@example.com'), 2::bigint,
  '...and both requests are stored, so the reply says nothing about earlier bookings');

-- A retry of the very same request (same id) does not create a second copy ----------------
set local role anon;
select lives_ok(
  format($$ insert into public.reservations (id, reservation_date, reservation_time, party_size, name, email)
            values ('11111111-1111-4111-8111-111111111111', %L, '09:00', 2, 'Retry', 'retry@example.com') $$, :'day'::date),
  'a request carrying its own id is stored');
select throws_ok(
  format($$ insert into public.reservations (id, reservation_date, reservation_time, party_size, name, email)
            values ('11111111-1111-4111-8111-111111111111', %L, '09:00', 2, 'Retry', 'retry@example.com') $$, :'day'::date),
  '23505', null, 'sending it again collides on the id instead of storing a duplicate');
reset role;

-- Rate limits ---------------------------------------------------------------------------
-- Per visitor: five an hour. This visitor has stored four so far.
set local role anon;
select lives_ok(:'fifth', 'a fifth request in the hour is accepted');
select throws_ok(:'another', 'PGRST', null, 'a sixth request in the hour from the same visitor is turned away');
reset role;

-- Claiming a different address in x-forwarded-for makes no difference.
select set_config('request.headers', :'home_pretending', true);
set local role anon;
select throws_ok(:'another', 'PGRST', null, 'pretending to be someone else in x-forwarded-for does not help');
reset role;

-- Someone else is unaffected.
select set_config('request.headers', :'elsewhere', true);
set local role anon;
select lives_ok(:'another', 'a different visitor is still accepted');
-- Several rows in one call are counted one by one, and the whole call fails together.
select throws_ok(
  format('insert into public.reservations (reservation_date, reservation_time, party_size, name, email)
          select %L::date + n, ''09:30'', 2, ''Bulk'', ''bulk'' || n || ''@example.com'' from generate_series(1, 6) n', :'day'::date),
  'PGRST', null, 'six requests in a single call are turned away');
reset role;
select is((select count(*) from public.reservations where name = 'Bulk'), 0::bigint,
  'nothing from the rejected call is stored');
select is((select count(*) from private.reservation_log where visitor = '198.51.100.20'), 1::bigint,
  '...or counted');

-- IPv6: one home network counts as one visitor, whatever address inside it is used.
select set_config('request.headers', :'v6_one', true);
set local role anon;
select lives_ok(
  format('insert into public.reservations (reservation_date, reservation_time, party_size, name, email)
          select %L::date + n, ''09:45'', 2, ''Six'', ''six'' || n || ''@example.com'' from generate_series(1, 5) n', :'day'::date),
  'five requests from one IPv6 address are accepted');
reset role;
select set_config('request.headers', :'v6_same_network', true);
set local role anon;
select throws_ok(:'another', 'PGRST', null, 'another address in the same IPv6 network shares that limit');
reset role;
select set_config('request.headers', :'v6_other_network', true);
set local role anon;
select lives_ok(:'other_net', 'a different IPv6 network is accepted');
reset role;

-- No usable address: accepted, and only the overall limits apply.
select set_config('request.headers', :'garbled', true);
set local role anon;
select lives_ok(:'garbled_req', 'a request with an unreadable address is accepted');
reset role;
select set_config('request.headers', '', true);
set local role anon;
select lives_ok(:'no_headers_req', 'a request with no headers at all is accepted');
reset role;
select is((select count(*) from private.reservation_log where visitor is null), 2::bigint,
  'both are counted without an address');

-- The cafe itself is not limited or logged, and can record any booking.
select lives_ok(
  format('insert into public.reservations (reservation_date, reservation_time, party_size, name, email, status)
          select %L, ''09:00'', 2, ''Walk-in '' || n, ''guest'' || n || ''@example.com'', ''confirmed''
          from generate_series(1, 80) n', :'day'::date - 30),
  'the cafe can add many bookings, including past ones, with any status');
select is((select count(*) from private.reservation_log), 14::bigint, 'the cafe''s own entries are not counted');

-- Overall: sixty an hour, however many visitors they come from.
insert into private.reservation_log (visitor, at)
select ('10.9.' || n || '.1')::inet, now() from generate_series(1, 46) n;
select set_config('request.headers', :'late_visitor', true);
set local role anon;
select throws_ok(:'after_cap', 'PGRST', null, 'requests are paused once the hourly total is reached');
reset role;

-- Old log entries are cleared out as new requests arrive.
delete from private.reservation_log;
insert into private.reservation_log (visitor, at) values ('192.0.2.1', now() - interval '3 days');
set local role anon;
select lives_ok(:'tidy', 'a request is accepted again once earlier ones have aged out');
reset role;
select is((select count(*) from private.reservation_log where at < now() - interval '2 days'), 0::bigint,
  'log entries older than two days are removed');

select * from finish();
rollback;

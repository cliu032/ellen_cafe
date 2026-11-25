-- pgTAP tests for boundaries and exemptions the other two suites do not pin down: seating-time
-- limits, tonight's visibility, a time already passed, the exact hourly total, service_role,
-- and that an owner's file delete cannot reach another bucket.
-- Run with `supabase test db`. Everything is rolled back at the end.
begin;
create extension if not exists pgtap;
select no_plan();
select set_config('storage.allow_delete_query', 'true', true);

select (now() at time zone 'Australia/Sydney')::date as today \gset
select :'today'::date + 7 as day \gset
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'owner-a@example.com');
insert into private.owners (user_id) values ('00000000-0000-4000-8000-0000000000a1');
select json_build_object('sub', '00000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text as owner \gset

-- dinner_services boundaries, as an owner
select set_config('request.jwt.claims', :'owner', true);
set local role authenticated;
select throws_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '15:45', '20:00') $$, :'day'::date + 1), '23514', null, 'a first seating at 3:45pm is refused: breakfast and lunch are walk-in only');
select lives_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '16:00', '16:00') $$, :'day'::date + 1), 'a first seating at 4pm is accepted, and the last may equal the first');
select throws_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '18:00', '20:10') $$, :'day'::date + 2), '23514', null, 'a last seating off the quarter hour is refused');
select throws_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating, created_at) values (%L, '18:00', '20:00', '2020-01-01') $$, :'day'::date + 2), '42501', null, 'an owner cannot set created_at');
select throws_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '18:00', '24:00') $$, :'day'::date + 2), '23514', null, 'a last seating of 24:00 is refused');
select lives_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '17:00', '22:15') $$, :'day'), 'an owner adds the test evening');
select lives_ok(format($$ insert into public.dinner_services (service_date, first_seating, last_seating) values (%L, '23:45', '23:45') $$, :'today'), 'an owner adds tonight');
reset role;

-- today is an upcoming date for a visitor
set local role anon;
select is((select count(*) from public.dinner_services where service_date = :'today'), 1::bigint, 'a visitor sees tonight''s dinner');
reset role;

-- the last seating itself can be requested
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.1"}', true);
set local role anon;
select lives_ok(format($$ insert into public.reservations (reservation_date, reservation_time, party_size, name, email) values (%L, '22:15', 2, 'Last', 'last@example.com') $$, :'day'), 'the last seating itself can be requested');
reset role;

-- a time today that has already passed (the 4pm rule is lifted inside this transaction so that one exists at any hour)
alter table public.dinner_services drop constraint dinner_services_in_the_evening;
update public.dinner_services set first_seating = '00:00' where service_date = :'today';
insert into public.dinner_services (service_date, first_seating, last_seating) values (:'today'::date + 1, '00:00', '23:45');
select to_char(date_trunc('hour', n) + floor(extract(minute from n) / 15) * interval '15 minutes', 'HH24:MI') as passed
from (select now() at time zone 'Australia/Sydney' as n) t \gset
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.2"}', true);
set local role anon;
select throws_ok(format($$ insert into public.reservations (reservation_date, reservation_time, party_size, name, email) values (%L, %L, 2, 'Gone', 'gone@example.com') $$, :'today', :'passed'), '42501', null, 'a time earlier today is refused');
select lives_ok(format($$ insert into public.reservations (reservation_date, reservation_time, party_size, name, email) values (%L, %L, 2, 'Tomorrow', 'tomorrow@example.com') $$, :'today'::date + 1, :'passed'), 'the same time tomorrow is accepted');
reset role;

-- service_role is not "the website": neither limited nor logged
select count(*) as log_before from private.reservation_log \gset
set local role service_role;
select lives_ok(format($$ insert into public.reservations (reservation_date, reservation_time, party_size, name, email) select %L, '18:00', 2, 'Svc', 'svc@example.com' from generate_series(1, 8) $$, :'day'), 'service_role can add more than five at once');
reset role;
select is((select count(*) from private.reservation_log), :log_before::bigint, '...and they are not counted');

-- overall hourly cap from below: the 60th is accepted, the 61st is not
delete from private.reservation_log;
insert into private.reservation_log (visitor, at) select ('10.7.' || n || '.1')::inet, now() from generate_series(1, 59) n;
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.3"}', true);
set local role anon;
select lives_ok(format($$ insert into public.reservations (reservation_date, reservation_time, party_size, name, email) values (%L, '18:00', 2, 'Sixtieth', 'sixtieth@example.com') $$, :'day'), 'the sixtieth request in the hour is accepted');
select throws_ok(format($$ insert into public.reservations (reservation_date, reservation_time, party_size, name, email) values (%L, '18:00', 2, 'Sixty-first', 'sixtyfirst@example.com') $$, :'day'), 'PGRST', null, 'the sixty-first is turned away');
reset role;

-- per visitor, requests from 45 minutes ago still count towards the hour
delete from private.reservation_log;
insert into private.reservation_log (visitor, at) select '198.51.100.4'::inet, now() - interval '45 minutes' from generate_series(1, 5);
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.4"}', true);
set local role anon;
select throws_ok(format($$ insert into public.reservations (reservation_date, reservation_time, party_size, name, email) values (%L, '18:30', 2, 'Sixth', 'sixth-in-hour@example.com') $$, :'day'), 'PGRST', null, 'five requests 45 minutes ago still count towards a visitor''s hour');
reset role;

-- an owner's unqualified file delete leaves other buckets alone
insert into storage.buckets (id, name, public) values ('elsewhere', 'elsewhere', false);
insert into storage.objects (bucket_id, name) values ('photos', 'a.jpg'), ('elsewhere', 'private.pdf');
select set_config('request.jwt.claims', :'owner', true);
set local role authenticated;
select lives_ok($$ delete from storage.objects $$, 'an owner''s delete of everything runs');
reset role;
select results_eq($$ select bucket_id from storage.objects $$, $$ values ('elsewhere') $$, '...and removes only the photo files');

-- no statistics exist (not merely "none will be gathered"), whatever the Postgres version
analyze public.reservations;
select is((select count(*) from pg_stats where schemaname = 'public' and tablename = 'reservations'), 0::bigint, 'no column statistics exist for reservations');
select ok((select bool_and(coalesce(attstattarget, -1) = 0) from pg_attribute where attrelid = 'public.reservations'::regclass and attnum > 0 and not attisdropped), 'every column has statistics switched off (a NULL target is the default on Postgres 17)');

select * from finish();
rollback;

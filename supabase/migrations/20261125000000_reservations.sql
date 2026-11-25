-- Reservation requests for ellen cafe & eatery.
--
-- How it is used
--   The website sends each request straight to the Data API with the project's publishable
--   key, so it arrives as the `anon` Postgres role. Owners read and answer requests in the
--   owner area (admin.html, see the next migration) or in the Supabase dashboard.
--
-- Security model
--   * anon can INSERT a request and nothing else: no select, update or delete.
--   * anon can only supply the guest's own columns (plus the row id, see below); created_at and
--     status are always set by the database.
--   * Row Level Security only lets through a 'pending' request for a time that is still ahead.
--   * A trigger tidies the text and applies rate limits.
--   * Nothing in a reply depends on what other guests have booked, so replies cannot be used
--     to find out whether someone has a reservation.
--
-- Business rules (opening hours, slot length, largest party) live in the website's
-- assets/config.js. The database enforces safety bounds only, so the two cannot drift apart.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.reservations (
  -- The website makes up the id itself. If a request is sent twice (a retry after a dropped
  -- connection), the second copy collides on this key instead of creating a duplicate.
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  reservation_date date not null,
  reservation_time time not null,
  party_size       smallint not null,
  name             text not null,
  email            text not null,
  phone            text,
  notes            text,
  status           text not null default 'pending',

  constraint reservations_time_on_quarter_hour check (
    extract(second from reservation_time) = 0
    and extract(minute from reservation_time)::int % 15 = 0
  ),
  constraint reservations_party_size_range check (party_size between 1 and 20),
  constraint reservations_name_valid check (
    char_length(name) between 1 and 100 and name !~ '[[:cntrl:]]'
  ),
  constraint reservations_email_valid check (
    char_length(email) <= 254
    and email = lower(email)
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint reservations_phone_valid check (
    phone is null or phone ~ '^[0-9+() .-]{5,30}$'
  ),
  constraint reservations_notes_length check (notes is null or char_length(notes) <= 500),
  constraint reservations_status_valid check (
    status in ('pending', 'confirmed', 'declined', 'cancelled')
  )
);

comment on table public.reservations is
  'Table requests from the website. New rows are ''pending'' until the cafe confirms or declines them.';
comment on column public.reservations.reservation_date is 'Date of the visit, in cafe local time (Australia/Sydney).';
comment on column public.reservations.reservation_time is 'Time of the visit, in cafe local time (Australia/Sydney).';
comment on column public.reservations.status is 'pending | confirmed | declined | cancelled. Set by the cafe.';

create index reservations_by_date on public.reservations (reservation_date, reservation_time);

-- Rate limiting needs to remember who sent a request recently. One row per accepted website
-- request; rows are removed after two days. `visitor` is the network address the request
-- came from (an IPv6 address is shortened to its /64 network), or null if unknown.
create table private.reservation_log (
  visitor inet,
  at      timestamptz not null default now()
);

comment on table private.reservation_log is
  'Recent website reservation requests, used only for rate limiting. Emptied of anything older than two days.';

create index reservation_log_by_visitor on private.reservation_log (visitor, at);
create index reservation_log_by_time on private.reservation_log (at);

-- Tidy guest input, then apply rate limits to requests that come from the website.
create function private.reservations_before_insert()
returns trigger
language plpgsql
security definer -- reads and writes private.reservation_log, which the website role cannot
set search_path = ''
as $$
declare
  -- The Data API runs each request as one of these roles. The cafe's own inserts from the
  -- dashboard run as another role and are neither limited nor logged.
  from_website constant boolean :=
    coalesce(current_setting('role', true), '') in ('anon', 'authenticated');
  this_visitor inet;
  too_many constant text := json_build_object(
    'code', 'RATE_LIMITED',
    'message', 'Too many reservation requests. Please try again later.',
    'details', null,
    'hint', null
  )::text;
  http_429 constant text := json_build_object(
    'status', 429,
    'status_text', 'Too Many Requests',
    'headers', json_build_object()
  )::text;
begin
  new.name  := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.email := lower(btrim(new.email));
  new.phone := nullif(btrim(regexp_replace(new.phone, '\s+', ' ', 'g')), '');
  new.notes := nullif(btrim(new.notes), '');

  if not from_website then
    return new;
  end if;

  -- Who is asking. Supabase's gateway sets the cf-connecting-ip header itself and refuses
  -- requests that try to supply their own, so a visitor cannot fake it. (x-forwarded-for
  -- is not used: a visitor can put anything they like at the front of it.)
  begin
    this_visitor := nullif(btrim(
      nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip'
    ), '')::inet;
    this_visitor := network(
      set_masklen(this_visitor, case family(this_visitor) when 6 then 64 else 32 end)
    )::inet;
  exception when others then
    this_visitor := null; -- no header, or not an address: only the overall limits apply
  end;

  -- One request at a time through the checks below, so the counts are exact.
  perform pg_advisory_xact_lock(hashtextextended('public.reservations rate limit', 0));

  delete from private.reservation_log l where l.at < now() - interval '2 days';

  -- Limits: 5 an hour and 15 a day from one visitor; 60 an hour and 300 a day overall.
  -- Every limit gives the same reply.
  if (
    this_visitor is not null
    and (
      (select count(*) from private.reservation_log l
        where l.visitor = this_visitor and l.at > now() - interval '1 hour') >= 5
      or (select count(*) from private.reservation_log l
        where l.visitor = this_visitor and l.at > now() - interval '1 day') >= 15
    )
  )
  or (select count(*) from private.reservation_log l where l.at > now() - interval '1 hour') >= 60
  or (select count(*) from private.reservation_log l where l.at > now() - interval '1 day') >= 300
  then
    raise sqlstate 'PGRST' using message = too_many, detail = http_429;
  end if;

  -- Counted only if the request is then stored: a row that fails a check below is rolled
  -- back together with this entry.
  insert into private.reservation_log (visitor) values (this_visitor);

  return new;
end;
$$;

revoke all on function private.reservations_before_insert() from public, anon, authenticated;

create trigger reservations_before_insert
  before insert on public.reservations
  for each row execute function private.reservations_before_insert();

-- Access. Start from nothing, then grant only what each role needs.
alter table public.reservations enable row level security;

revoke all on table public.reservations from public, anon, authenticated;

grant insert (id, reservation_date, reservation_time, party_size, name, email, phone, notes)
  on table public.reservations to anon;

grant select, insert, update, delete on table public.reservations to service_role;

create policy "Website visitors can request a table for a time still ahead"
  on public.reservations
  for insert
  to anon
  with check (
    status = 'pending'
    and (reservation_date + reservation_time) > (now() at time zone 'Australia/Sydney')
    and reservation_date <= (now() at time zone 'Australia/Sydney')::date + 366
  );

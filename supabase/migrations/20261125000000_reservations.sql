-- Reservation requests for ellen cafe & eatery.
--
-- How it is used
--   The website sends each request straight to the Data API with the project's publishable
--   key, so it arrives as the `anon` Postgres role. The cafe reads and updates requests in the
--   Supabase dashboard (Table Editor), which is not subject to these restrictions.
--
-- Security model
--   * anon can INSERT a request and nothing else: no select, update or delete.
--   * anon can only supply the guest's own columns; id, created_at and status are always
--     set by the database.
--   * Row Level Security only lets through a 'pending' request for a time that is still ahead.
--   * A trigger tidies the text and applies rate limits.
--
-- Business rules (opening hours, slot length, largest party) live in the website's
-- assets/config.js. The database enforces safety bounds only, so the two cannot drift apart.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.reservations (
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

-- One live request per guest per slot. Cancelled and declined requests do not block a new one.
create unique index reservations_one_live_request_per_slot
  on public.reservations (email, reservation_date, reservation_time)
  where status in ('pending', 'confirmed');

create index reservations_by_date on public.reservations (reservation_date, reservation_time);
create index reservations_by_created_at on public.reservations (created_at);

-- Tidy guest input, then apply rate limits to requests that come from the website.
create function private.reservations_before_insert()
returns trigger
language plpgsql
security definer -- needs to count existing rows, which the website role cannot read
set search_path = ''
as $$
declare
  -- The Data API runs each request as one of these roles. The cafe's own inserts from the
  -- dashboard run as another role and are not limited.
  from_website constant boolean :=
    coalesce(current_setting('role', true), '') in ('anon', 'authenticated');
  today constant date := (now() at time zone 'Australia/Sydney')::date;
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

  -- One request at a time through the checks below, so the counts are exact.
  perform pg_advisory_xact_lock(hashtextextended('public.reservations rate limit', 0));

  -- The same guest sending the same request again (double click, retry): accept it without
  -- storing a second copy. The reply is identical either way, so it reveals nothing about
  -- who has booked.
  if exists (
    select 1
    from public.reservations r
    where r.email = new.email
      and r.reservation_date = new.reservation_date
      and r.reservation_time = new.reservation_time
      and r.status in ('pending', 'confirmed')
  ) then
    return null;
  end if;

  -- Limits. All three give the same reply.
  if (
    select count(*)
    from public.reservations r
    where r.email = new.email
      and r.reservation_date >= today
      and r.status in ('pending', 'confirmed')
  ) >= 5
  or (select count(*) from public.reservations r where r.created_at > now() - interval '1 hour') >= 60
  or (select count(*) from public.reservations r where r.created_at > now() - interval '1 day') >= 300
  then
    raise sqlstate 'PGRST' using message = too_many, detail = http_429;
  end if;

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

grant insert (reservation_date, reservation_time, party_size, name, email, phone, notes)
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

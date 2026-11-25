-- Fixes from review of the first two migrations, and one rule from the cafe: breakfast and
-- lunch are walk-in only, so the website may only ask for a dinner table.

-- 1. Owners are accounts, not email addresses -------------------------------------------------
-- The owner list used to hold email addresses. Whoever held a listed address as a confirmed
-- account was an owner, which made access depend on who registered that address first. The
-- list now names accounts directly, and an entry disappears with its account.

drop policy "Owners can read reservations" on public.reservations;
drop policy "Owners can set a reservation's status" on public.reservations;
drop policy "Owners can delete reservations" on public.reservations;
drop policy "Owners can add photos" on public.photos;
drop policy "Owners can edit photos" on public.photos;
drop policy "Owners can remove photos" on public.photos;
drop policy "Owners can upload photos" on storage.objects;
drop policy "Owners can list photos" on storage.objects;
drop policy "Owners can delete photos" on storage.objects;
drop function public.is_owner();
drop function private.is_owner();
drop table private.owners;

create table private.owners (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

comment on table private.owners is
  'Accounts allowed into the owner area (admin.html). One row per account; deleting the account removes its row.';

-- True when the signed-in account is on the owner list.
create function private.is_owner()
returns boolean
language sql
stable
security definer -- private.owners is not readable by the signed-in role
set search_path = ''
as $$
  select exists (
    select 1 from private.owners o where o.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_owner() from public, anon;
grant execute on function private.is_owner() to authenticated;

-- Lets admin.html ask "am I an owner?" so it can explain itself to an account that is not.
create function public.is_owner()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.is_owner();
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create policy "Owners can read reservations"
  on public.reservations for select to authenticated
  using ((select private.is_owner()));

create policy "Owners can set a reservation's status"
  on public.reservations for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

create policy "Owners can delete reservations"
  on public.reservations for delete to authenticated
  using ((select private.is_owner()));

create policy "Owners can add photos"
  on public.photos for insert to authenticated
  with check ((select private.is_owner()));

create policy "Owners can edit photos"
  on public.photos for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

create policy "Owners can remove photos"
  on public.photos for delete to authenticated
  using ((select private.is_owner()));

create policy "Owners can upload photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (select private.is_owner()));

-- Deleting a file through the Storage API needs both the select and the delete policy.
create policy "Owners can list photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (select private.is_owner()));

create policy "Owners can delete photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (select private.is_owner()));

-- 2. Give a signed-in account that is not an owner nothing to infer ----------------------------
-- Row level security hides every row from such an account, but it may still ask the Data API
-- for a *planned* row count, which is the query planner's estimate. With column statistics
-- that estimate changes with the values asked about (an email address, a date). Without
-- statistics every estimate is the same fixed fraction of the table's size, so it says
-- nothing about any guest or any day. The table is tiny; the planner does not need them.
-- (Public sign-up should be off for this project anyway, so that no such account exists.)
alter table public.reservations
  alter column id set statistics 0,
  alter column created_at set statistics 0,
  alter column reservation_date set statistics 0,
  alter column reservation_time set statistics 0,
  alter column party_size set statistics 0,
  alter column name set statistics 0,
  alter column email set statistics 0,
  alter column phone set statistics 0,
  alter column notes set statistics 0,
  alter column status set statistics 0;

analyze public.reservations;

-- 3. Rate limiting ------------------------------------------------------------------------------

alter table private.reservation_log add column id bigint generated always as identity primary key;

comment on table private.reservation_log is
  'Recent website reservation requests, used only for rate limiting. Entries older than two days are cleared whenever a new request is accepted.';

create or replace function private.reservations_before_insert()
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
    -- An IPv4 address written in IPv6 form (::ffff:203.0.113.5) is that IPv4 address.
    if family(this_visitor) = 6 and this_visitor << '::ffff:0:0/96'::inet then
      this_visitor := substring(host(this_visitor) from '[0-9.]+$')::inet;
    end if;
    -- One household or office usually holds a whole IPv6 /56, so count it as one visitor.
    this_visitor := network(
      set_masklen(this_visitor, case family(this_visitor) when 6 then 56 else 32 end)
    )::inet;
  exception when others then
    this_visitor := null; -- no header, or not an address: only the overall limits apply
  end;

  -- One request at a time through the checks below, so the counts are exact.
  perform pg_advisory_xact_lock(hashtextextended('public.reservations rate limit', 0));

  -- A request that is already stored is being sent again (the reply to the first try was
  -- lost). Let it through to collide on its id, without counting or limiting it. The id is
  -- one the sender made up, so this says nothing about anyone else's requests.
  if exists (select 1 from public.reservations r where r.id = new.id) then
    return new;
  end if;

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

-- 4. Photos: a size is either both numbers or neither -------------------------------------------

alter table public.photos drop constraint photos_size_valid;
alter table public.photos add constraint photos_size_valid check (
  (width is null) = (height is null)
  and (width is null or (width between 1 and 20000 and height between 1 and 20000))
);

-- 5. Reservations are for dinner ----------------------------------------------------------------
-- Breakfast and lunch are walk-in only. The website offers dinner times from the nights set in
-- assets/config.js; as a safety bound the database refuses any website request before 4pm.

drop policy "Website visitors can request a table for a time still ahead" on public.reservations;

create policy "Website visitors can request a dinner table for a time still ahead"
  on public.reservations
  for insert
  to anon
  with check (
    status = 'pending'
    and reservation_time >= time '16:00'
    and (reservation_date + reservation_time) > (now() at time zone 'Australia/Sydney')
    and reservation_date <= (now() at time zone 'Australia/Sydney')::date + 366
  );

comment on table public.reservations is
  'Dinner reservation requests from the website. New rows are ''pending'' until the cafe confirms or declines them.';

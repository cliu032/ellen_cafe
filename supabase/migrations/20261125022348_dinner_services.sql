-- Dinner is served only on evenings the owner picks. Each row is one such evening, with the
-- first and last time a table can be reserved. Owners manage the rows in the owner area; the
-- website reads the upcoming ones, and a reservation request is only accepted for one of them.

create table public.dinner_services (
  service_date  date primary key,
  first_seating time not null,
  last_seating  time not null,
  created_at    timestamptz not null default now(),

  constraint dinner_services_in_the_evening check (first_seating >= time '16:00'),
  constraint dinner_services_in_order check (last_seating >= first_seating),
  constraint dinner_services_on_quarter_hours check (
    extract(second from first_seating) = 0 and extract(minute from first_seating)::int % 15 = 0
    and extract(second from last_seating) = 0 and extract(minute from last_seating)::int % 15 = 0
  )
);

comment on table public.dinner_services is
  'Evenings dinner is served, picked by the owner. Reservations can only be requested for these dates, between first_seating and last_seating.';
comment on column public.dinner_services.service_date is 'The evening, in cafe local time (Australia/Sydney).';
comment on column public.dinner_services.first_seating is 'Earliest time a table can be reserved.';
comment on column public.dinner_services.last_seating is 'Latest time a table can be reserved.';

alter table public.dinner_services enable row level security;

revoke all on table public.dinner_services from public, anon, authenticated;
grant select on table public.dinner_services to anon, authenticated;
grant insert (service_date, first_seating, last_seating) on table public.dinner_services to authenticated;
grant update (first_seating, last_seating) on table public.dinner_services to authenticated;
grant delete on table public.dinner_services to authenticated;
grant select, insert, update, delete on table public.dinner_services to service_role;

-- Visitors see today's and future evenings. Owners also see past ones.
create policy "Anyone can see upcoming dinner dates"
  on public.dinner_services
  for select
  to anon
  using (service_date >= (now() at time zone 'Australia/Sydney')::date);

create policy "Signed-in accounts see upcoming dinner dates, owners see all"
  on public.dinner_services
  for select
  to authenticated
  using (
    service_date >= (now() at time zone 'Australia/Sydney')::date
    or (select private.is_owner())
  );

create policy "Owners can add dinner dates"
  on public.dinner_services
  for insert
  to authenticated
  with check ((select private.is_owner()));

create policy "Owners can change dinner times"
  on public.dinner_services
  for update
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

create policy "Owners can remove dinner dates"
  on public.dinner_services
  for delete
  to authenticated
  using ((select private.is_owner()));

-- A reservation request must now be for one of those evenings, within its seating times.
-- (This also replaces the earlier policy, whose name was longer than Postgres allows and had
-- been cut short.)
drop policy "Website visitors can request a dinner table for a time still ah" on public.reservations;

create policy "Website visitors can request a dinner table"
  on public.reservations
  for insert
  to anon
  with check (
    status = 'pending'
    and (reservation_date + reservation_time) > (now() at time zone 'Australia/Sydney')
    and exists (
      select 1
      from public.dinner_services s
      where s.service_date = reservation_date
        and reservation_time between s.first_seating and s.last_seating
    )
  );

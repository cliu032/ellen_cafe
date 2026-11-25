-- Owner area: who counts as an owner, what owners can do with reservations, and site photos.
--
-- Owners sign in on admin.html with Supabase Auth, so their requests arrive as the
-- `authenticated` Postgres role. Being signed in is not enough: every owner policy below also
-- requires the account's confirmed email address to be listed in private.owners.

-- 1. Owners ---------------------------------------------------------------------------------

create table private.owners (
  email    text primary key,
  added_at timestamptz not null default now(),
  constraint owners_email_normalised check (email = lower(btrim(email)) and email <> '')
);

comment on table private.owners is
  'Email addresses allowed into the owner area (admin.html). Add or remove a row to change who has access.';

-- True when the signed-in account has a confirmed email address listed in private.owners.
-- Reads auth.users directly, so removing an owner or deleting the account takes effect at once.
create function private.is_owner()
returns boolean
language sql
stable
security definer -- auth.users and private.owners are not readable by the signed-in role
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join private.owners o on o.email = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function private.is_owner() from public, anon;
grant usage on schema private to authenticated;
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
grant execute on function public.is_owner() to authenticated, service_role;

-- 2. Reservations: owners read them, set the status, and delete junk --------------------------

grant select, delete on table public.reservations to authenticated;
grant update (status) on table public.reservations to authenticated;

create policy "Owners can read reservations"
  on public.reservations
  for select
  to authenticated
  using ((select private.is_owner()));

create policy "Owners can set a reservation's status"
  on public.reservations
  for update
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

create policy "Owners can delete reservations"
  on public.reservations
  for delete
  to authenticated
  using ((select private.is_owner()));

-- 3. Photos shown on the website ---------------------------------------------------------------
-- The image files live in the public Storage bucket `photos`; this table says which of them
-- appear on the site, in what order, and with what description.

create table public.photos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  path       text not null unique,
  alt        text not null default '',
  sort_order integer not null default 0,
  width      integer,
  height     integer,

  -- A plain file name inside the bucket: no folders, nothing that could point elsewhere.
  constraint photos_path_valid check (path ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  constraint photos_alt_length check (char_length(alt) <= 200 and alt !~ '[[:cntrl:]]'),
  constraint photos_size_valid check (
    (width is null and height is null)
    or (width between 1 and 20000 and height between 1 and 20000)
  )
);

comment on table public.photos is
  'Photos shown on the website. `path` is the file name in the public Storage bucket `photos`.';
comment on column public.photos.alt is 'Short description of the photo, read aloud by screen readers.';
comment on column public.photos.sort_order is 'Lower numbers are shown first.';

create index photos_by_order on public.photos (sort_order, created_at);

alter table public.photos enable row level security;

revoke all on table public.photos from public, anon, authenticated;
grant select on table public.photos to anon, authenticated;
grant insert (path, alt, sort_order, width, height) on table public.photos to authenticated;
grant update (alt, sort_order) on table public.photos to authenticated;
grant delete on table public.photos to authenticated;
grant select, insert, update, delete on table public.photos to service_role;

create policy "Anyone can see the photos"
  on public.photos
  for select
  to anon, authenticated
  using (true);

create policy "Owners can add photos"
  on public.photos
  for insert
  to authenticated
  with check ((select private.is_owner()));

create policy "Owners can edit photos"
  on public.photos
  for update
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

create policy "Owners can remove photos"
  on public.photos
  for delete
  to authenticated
  using ((select private.is_owner()));

-- 4. Storage bucket for the image files ---------------------------------------------------------
-- Public bucket: anyone can fetch a file by its URL without a policy. Uploading, listing and
-- deleting go through the policies below, so only owners can do those.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners can upload photos"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'photos' and (select private.is_owner()));

-- Deleting a file through the Storage API needs both the select and the delete policy.
create policy "Owners can list photos"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'photos' and (select private.is_owner()));

create policy "Owners can delete photos"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'photos' and (select private.is_owner()));

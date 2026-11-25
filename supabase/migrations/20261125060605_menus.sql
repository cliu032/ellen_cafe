-- The menus. Two rows: lunch (the daytime, walk-in menu; breakfast lives in it too) and dinner.
-- Owners edit them in the owner area; the website reads them. A menu is stored, and saved,
-- whole: a short note shown above it, and a list of sections, each a title and its items.

-- True when a value is a well-formed list of menu sections:
--   [{ "title": text, "items": [{ "name": text, "desc": text?, "price": text? }, ...] }, ...]
-- Limits: 12 sections, 40 items in a section; title 40 characters (may be empty), name 80,
-- desc 200, price 24. Prices are free text ("5 / 5.5"). Nothing but these keys is allowed,
-- so the stored menu holds only what the website shows.
create function private.menu_sections_valid(sections jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  section jsonb;
  item    jsonb;
begin
  if sections is null or jsonb_typeof(sections) <> 'array' then return false; end if;
  if jsonb_array_length(sections) > 12 then return false; end if;
  for section in select e from jsonb_array_elements(sections) e loop
    if jsonb_typeof(section) <> 'object' then return false; end if;
    if (section - 'title' - 'items') <> '{}'::jsonb then return false; end if;
    if jsonb_typeof(section -> 'title') is distinct from 'string' then return false; end if;
    if char_length(section ->> 'title') > 40 then return false; end if;
    if jsonb_typeof(section -> 'items') is distinct from 'array' then return false; end if;
    if jsonb_array_length(section -> 'items') > 40 then return false; end if;
    for item in select e from jsonb_array_elements(section -> 'items') e loop
      if jsonb_typeof(item) <> 'object' then return false; end if;
      if (item - 'name' - 'desc' - 'price') <> '{}'::jsonb then return false; end if;
      if jsonb_typeof(item -> 'name') is distinct from 'string' then return false; end if;
      if btrim(item ->> 'name') = '' or char_length(item ->> 'name') > 80 then return false; end if;
      if item ? 'desc' then
        if jsonb_typeof(item -> 'desc') <> 'string' or char_length(item ->> 'desc') > 200 then return false; end if;
      end if;
      if item ? 'price' then
        if jsonb_typeof(item -> 'price') <> 'string' or char_length(item ->> 'price') > 24 then return false; end if;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

revoke all on function private.menu_sections_valid(jsonb) from public, anon;
grant execute on function private.menu_sections_valid(jsonb) to authenticated, service_role;

create table public.menus (
  kind       text primary key,
  note       text not null default '',
  sections   jsonb not null default '[]'::jsonb,
  version    integer not null default 1,
  updated_at timestamptz not null default now(),

  constraint menus_kind_known check (kind in ('lunch', 'dinner')),
  constraint menus_note_short check (char_length(note) <= 200),
  constraint menus_sections_valid check (private.menu_sections_valid(sections))
);

comment on table public.menus is
  'The lunch and dinner menus, one row each. Edited in the owner area (admin.html), read by the website.';
comment on column public.menus.note is 'A short line shown above the menu. May be empty.';
comment on column public.menus.sections is 'The menu itself: [{title, items: [{name, desc?, price?}]}].';
comment on column public.menus.version is
  'Goes up by one on every save. A save names the version it started from, so it cannot silently overwrite a newer one.';

-- Every save moves the version on and stamps the time, whatever the client sent.
create function private.menus_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.menus_before_update() from public, anon, authenticated;

create trigger menus_before_update
  before update on public.menus
  for each row execute function private.menus_before_update();

alter table public.menus enable row level security;

-- The two rows are created here and never added to or removed: the API roles may read, and
-- signed-in accounts may change the note and the sections (row level security then narrows
-- that to owners).
revoke all on table public.menus from public, anon, authenticated;
grant select on table public.menus to anon, authenticated;
grant update (note, sections) on table public.menus to authenticated;
grant select, insert, update, delete on table public.menus to service_role;

-- The lunch menu is always public. The dinner menu is public only while a dinner date is
-- coming up, so the website cannot show a dinner menu when no dinner is on offer, and a menu
-- being prepared stays unseen until its first date is added.
create policy "Anyone can read the lunch menu, and dinner while it is on offer"
  on public.menus
  for select
  to anon
  using (
    kind = 'lunch'
    or exists (
      select 1 from public.dinner_services s
      where s.service_date >= (now() at time zone 'Australia/Sydney')::date
    )
  );

create policy "Signed-in accounts read the same menus, owners read both"
  on public.menus
  for select
  to authenticated
  using (
    kind = 'lunch'
    or (select private.is_owner())
    or exists (
      select 1 from public.dinner_services s
      where s.service_date >= (now() at time zone 'Australia/Sydney')::date
    )
  );

create policy "Owners can change the menus"
  on public.menus
  for update
  to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

-- The lunch menu starts as the sample that was written into the website; dinner starts empty.
insert into public.menus (kind, note, sections) values
  ('lunch', 'A sample menu. Dishes and prices change.', $menu$[
    {"title":"coffee & drinks","items":[{"name":"white, black","price":"5 / 5.5"},{"name":"filter","price":"6 / 6.5"},{"name":"honeycomb espresso","price":"9"},{"name":"tea","desc":"breakfast, earl grey, jasmine, oolong","price":"6"},{"name":"hot chocolate","price":"5.5"},{"name":"cold press seasonal juice","price":"8"},{"name":"grapefruit soda","price":"9"}]},
    {"title":"before 11am","items":[{"name":"black forest bacon & egg roll","desc":"bacon XO, bbq sauce, pickle","price":"13"},{"name":"scrambled egg & sourdough","desc":"tomato, sautéed mushrooms","price":"18"}]},
    {"title":"brunch","items":[{"name":"fries, seaweed seasoning","price":"7"},{"name":"poached chicken sandwich","desc":"roasted garlic aioli, jalapeño, rocket","price":"18"},{"name":"strawberry & pistachio","desc":"muesli, greek yoghurt, buckwheat, basil","price":"19"},{"name":"fish burger","desc":"pickle, mustard, cheddar, horseradish mayo, lettuce","price":"19"},{"name":"avocado & soft boiled egg","desc":"cashew, crouton, pecorino, salsa verde","price":"23"},{"name":"green peas & steam prawn","desc":"63c egg, horseradish mayonnaise, sourdough","price":"26"},{"name":"prawn pasta","desc":"shellfish bisque, grape tomato, prawn oil vinaigrette, tarragon","price":"32"}]},
    {"title":"after 11am & sweets","items":[{"name":"kransky sausage","desc":"sauerkraut, hash brown, yellow mustard, fried egg","price":"25"},{"name":"wagyu rump cap steak","desc":"pepper purée, turkish chilli, green peppercorn jus","price":"47"},{"name":"canelé","price":"7"},{"name":"custard, grand marnier","price":"9"}]}
  ]$menu$::jsonb),
  ('dinner', '', '[]'::jsonb);

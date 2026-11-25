-- Postgres accepts 24:00:00 as a time of day. A last seating of "24:00" would pass the other
-- checks, but the website and owner area treat times as 00:00–23:59 and would silently drop
-- the evening. Seating times end at 23:45.

alter table public.dinner_services
  add constraint dinner_services_before_midnight check (last_seating <= time '23:45');

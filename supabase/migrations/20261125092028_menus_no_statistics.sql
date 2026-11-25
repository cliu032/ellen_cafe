-- Keep the hidden dinner menu out of the query planner's statistics.
--
-- A visitor is never sent the dinner row while no dinner date is coming up. But the Data API
-- will also give a *planned* row count for any filter, which is the planner's estimate, and
-- that estimate is worked out from column statistics gathered over every row, hidden or not.
-- By asking about one value after another a visitor could have worked out the hidden menu's
-- note, its version and when it was last saved. (The dishes were not exposed this way.)
--
-- Without statistics every estimate is the same whatever the hidden row holds. The table has
-- two rows; the planner does not need them. `kind` keeps its statistics: both of its values
-- are public. The same was done for public.reservations.
alter table public.menus
  alter column note set statistics 0,
  alter column sections set statistics 0,
  alter column version set statistics 0,
  alter column updated_at set statistics 0;

-- Switching statistics off stops new ones being gathered but leaves any that already exist.
-- Restating each column's type (to what it already is) discards them, so this works whether
-- or not the table has been analysed yet. Constraints, the trigger, the policies, the column
-- grants and the stored menus are untouched.
alter table public.menus
  alter column note type text,
  alter column sections type jsonb,
  alter column version type integer,
  alter column updated_at type timestamptz;

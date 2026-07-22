-- Down migration for 20260723000000_add_rooms_completed_entry
--
-- Additive-only up migration (new table, no existing column/constraint
-- touched) — reversal is a straight drop. All rows in RoomsCompletedEntry
-- are lost; there is no prior state to restore them to.
BEGIN;

  DROP TABLE "RoomsCompletedEntry";

COMMIT;

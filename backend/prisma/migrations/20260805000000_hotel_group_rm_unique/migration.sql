-- ADR-030 D-5 / Regional Manager V1 Decision 1 (single group per RM).
-- Guarded pre-check: an unqualified ALTER TABLE ... ADD CONSTRAINT UNIQUE
-- would fail with a generic Postgres unique-violation error if any RM
-- currently manages 2+ hotel groups, without naming which rows. This raises
-- an explicit, actionable error instead so a human can resolve the data
-- before the constraint lands, rather than deploy failing on an opaque
-- Postgres message.
DO $$
DECLARE
  offending TEXT;
BEGIN
  SELECT string_agg(regional_manager_user_id || ' (' || cnt || ' groups)', ', ')
  INTO offending
  FROM (
    SELECT regional_manager_user_id, COUNT(*) AS cnt
    FROM "HotelGroup"
    GROUP BY regional_manager_user_id
    HAVING COUNT(*) > 1
  ) dupes;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add HotelGroup.regional_manager_user_id UNIQUE constraint: % already manage(s) multiple groups. Reassign each user to exactly one group before re-running this migration.', offending;
  END IF;
END $$;

ALTER TABLE "HotelGroup" ADD CONSTRAINT "HotelGroup_regional_manager_user_id_key" UNIQUE ("regional_manager_user_id");

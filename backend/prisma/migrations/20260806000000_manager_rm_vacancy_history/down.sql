-- Down migration for 20260806000000_manager_rm_vacancy_history

DROP TABLE "HotelManagerAssignmentHistory";
DROP TABLE "RegionalManagerAssignmentHistory";

ALTER TABLE "Hotel" DROP COLUMN "manager_vacancy_reason";
ALTER TABLE "Hotel" DROP COLUMN "manager_vacated_at";
ALTER TABLE "Hotel" DROP COLUMN "manager_assigned_at";

ALTER TABLE "HotelGroup" DROP COLUMN "regional_manager_vacancy_reason";
ALTER TABLE "HotelGroup" DROP COLUMN "regional_manager_vacated_at";
ALTER TABLE "HotelGroup" DROP COLUMN "regional_manager_assigned_at";

-- Restore the original RESTRICT-on-delete FK before re-tightening the
-- column back to NOT NULL (a NOT NULL column with an ON DELETE SET NULL FK
-- is a contradiction Postgres would otherwise silently leave in place).
ALTER TABLE "HotelGroup" DROP CONSTRAINT "HotelGroup_regional_manager_user_id_fkey";
ALTER TABLE "HotelGroup"
  ADD CONSTRAINT "HotelGroup_regional_manager_user_id_fkey"
  FOREIGN KEY ("regional_manager_user_id") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guarded pre-check, mirroring 20260805000000_hotel_group_rm_unique's own
-- pattern: re-tightening to NOT NULL fails outright (with an unhelpful
-- generic error) if any group went vacant while this migration was live.
-- Surface which groups first, so a human can resolve them before re-running
-- the rollback, rather than deploy failing on an opaque Postgres message.
DO $$
DECLARE
  offending TEXT;
BEGIN
  SELECT string_agg(id, ', ')
  INTO offending
  FROM "HotelGroup"
  WHERE "regional_manager_user_id" IS NULL;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot roll back manager_rm_vacancy_history: HotelGroup row(s) % are currently vacant (regional_manager_user_id IS NULL), which the pre-migration schema cannot represent. Assign a Regional Manager to each before rolling back.', offending;
  END IF;
END $$;

ALTER TABLE "HotelGroup" ALTER COLUMN "regional_manager_user_id" SET NOT NULL;

DROP TYPE "ManagerVacancyReason";

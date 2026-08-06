-- Person-centric assignment redesign (2026-08-07).
--
-- Adds EmploymentRecord.primary_hotel_id: DISPLAY/DEFAULT-SELECTION ONLY.
-- This is explicitly NOT an eligibility restriction -- a worker's eligibility
-- to work a hotel remains governed exclusively by EmploymentRecord.
-- hotel_group_id (unchanged) via backend/src/lib/roster-scope.ts. A worker
-- may work ANY hotel in their assigned group (REQ-EMP-012, frozen spec).
-- This column exists solely so the UI has a sensible default hotel to
-- preselect for a worker/checker; roster-scope.ts must never read it.
--
-- Additive-nullable-column pattern (matches the repo's existing migrations,
-- e.g. 20260806000000_manager_rm_vacancy_history): no backfill needed since
-- the column starts NULL for every existing row, which is a valid state
-- ("no primary hotel selected yet").

ALTER TABLE "EmploymentRecord" ADD COLUMN "primary_hotel_id" TEXT;

ALTER TABLE "EmploymentRecord"
  ADD CONSTRAINT "EmploymentRecord_primary_hotel_id_fkey"
  FOREIGN KEY ("primary_hotel_id") REFERENCES "Hotel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "EmploymentRecord_primary_hotel_id_idx" ON "EmploymentRecord"("primary_hotel_id");

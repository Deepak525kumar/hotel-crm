-- Manager/RM vacancy-history model (2026-08-06).
--
-- NULL alone is ambiguous for Hotel.manager_user_id / HotelGroup
-- .regional_manager_user_id: never assigned, demoted, resigned, terminated,
-- transferred, or temporarily unassigned all look identical. This migration
-- makes "no manager" an intentional, explained state (vacancy fields) and
-- keeps a full assignment/vacancy audit trail independent of the current
-- pointer (the two *AssignmentHistory tables).
--
-- Also relaxes HotelGroup.regional_manager_user_id from NOT NULL to nullable
-- (a group may now go temporarily vacant on RM demotion, rather than being
-- unable to demote its RM at all until a replacement is named). The existing
-- UNIQUE constraint (20260805000000_hotel_group_rm_unique) is preserved as-is
-- -- Postgres permits multiple NULL rows under a unique index, so several
-- groups can be vacant at once while a non-null value still names at most
-- one group.
--
-- KNOWN LIMITATION: this migration does NOT backfill history rows for
-- currently-assigned managers/RMs (only the vacancy fields on Hotel/
-- HotelGroup themselves get backfilled, below). The history tables start
-- genuinely empty and only gain rows from the FIRST assign/unassign that
-- happens after this migration lands -- a manager/RM assigned before this
-- migration has no opening row until they are next reassigned or demoted.
-- This was a deliberate choice: fabricating a history row from the same
-- unreliable proxy timestamps discussed below would produce fake-precision
-- history entries, which is worse than an honestly incomplete table.

CREATE TYPE "ManagerVacancyReason" AS ENUM (
  'NOT_ASSIGNED',
  'DEMOTED',
  'RESIGNED',
  'TERMINATED',
  'TRANSFERRED',
  'TEMPORARY'
);

-- ── HotelGroup: relax regional_manager_user_id to nullable, add vacancy fields ──

ALTER TABLE "HotelGroup" ALTER COLUMN "regional_manager_user_id" DROP NOT NULL;

-- The existing FK (added when the column was NOT NULL) had no explicit
-- ON DELETE action, which defaults to RESTRICT -- fine for a required
-- column, but now that the column can be cleared to NULL on demotion rather
-- than only on a User row deletion, SetNull is the correct action for that
-- path too. Recreate the constraint with ON DELETE SET NULL to match the
-- schema's `onDelete: SetNull`.
ALTER TABLE "HotelGroup" DROP CONSTRAINT "HotelGroup_regional_manager_user_id_fkey";
ALTER TABLE "HotelGroup"
  ADD CONSTRAINT "HotelGroup_regional_manager_user_id_fkey"
  FOREIGN KEY ("regional_manager_user_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HotelGroup" ADD COLUMN "regional_manager_assigned_at" TIMESTAMP(3);
ALTER TABLE "HotelGroup" ADD COLUMN "regional_manager_vacated_at" TIMESTAMP(3);
ALTER TABLE "HotelGroup" ADD COLUMN "regional_manager_vacancy_reason" "ManagerVacancyReason";

-- Backfill: every HotelGroup existing today already has an RM assigned --
-- regional_manager_user_id was NOT NULL until the ALTER above, so the
-- group could not have existed for even one moment without one. created_at
-- is therefore a genuine lower bound on the true assignment time (assignment
-- happened AT creation, since there was no other way to create the row),
-- not merely an approximation -- unlike Hotel.manager_assigned_at below,
-- which is deliberately left NULL because no equivalent guarantee holds
-- there (manager_user_id was already nullable, assigned later via a
-- separate PATCH, so the hotel's own timestamps say nothing reliable about
-- when that assignment happened).
UPDATE "HotelGroup" SET "regional_manager_assigned_at" = "created_at" WHERE "regional_manager_user_id" IS NOT NULL;

-- ── Hotel: add vacancy fields (manager_user_id was already nullable) ──

ALTER TABLE "Hotel" ADD COLUMN "manager_assigned_at" TIMESTAMP(3);
ALTER TABLE "Hotel" ADD COLUMN "manager_vacated_at" TIMESTAMP(3);
ALTER TABLE "Hotel" ADD COLUMN "manager_vacancy_reason" "ManagerVacancyReason";

-- Deliberately NOT backfilled from updated_at: unlike HotelGroup.created_at
-- above (a genuine lower bound -- the column was NOT NULL at creation, so
-- assignment truly happened no later than creation), Hotel.updated_at is a
-- generic @updatedAt column bumped by ANY field write (name, address,
-- is_active, accepting_jobs, coordinates, ...), not specifically the
-- manager assignment. Backfilling from it would fabricate a plausible-
-- looking but false date whenever an unrelated edit landed after the real
-- assignment (assign manager -> unrelated phone-number edit a year later ->
-- this migration -> manager_assigned_at reads as "a year later", not the
-- true assignment date). The true assignment time was never recorded
-- before this migration and cannot be reconstructed; leaving it NULL for
-- pre-existing assignments is honest about that, and the going-forward
-- writes in updateHotel() are exact from this point on.

-- ── History tables ──

CREATE TABLE "RegionalManagerAssignmentHistory" (
  "id" TEXT NOT NULL,
  "hotel_group_id" TEXT NOT NULL,
  "regional_manager_user_id" TEXT NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL,
  "unassigned_at" TIMESTAMP(3),
  "assigned_by_id" TEXT,
  "unassigned_by_id" TEXT,
  "reason" "ManagerVacancyReason",

  CONSTRAINT "RegionalManagerAssignmentHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegionalManagerAssignmentHistory_hotel_group_id_idx" ON "RegionalManagerAssignmentHistory"("hotel_group_id");
CREATE INDEX "RegionalManagerAssignmentHistory_regional_manager_user_id_idx" ON "RegionalManagerAssignmentHistory"("regional_manager_user_id");

ALTER TABLE "RegionalManagerAssignmentHistory"
  ADD CONSTRAINT "RegionalManagerAssignmentHistory_hotel_group_id_fkey"
  FOREIGN KEY ("hotel_group_id") REFERENCES "HotelGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegionalManagerAssignmentHistory"
  ADD CONSTRAINT "RegionalManagerAssignmentHistory_regional_manager_user_id_fkey"
  FOREIGN KEY ("regional_manager_user_id") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegionalManagerAssignmentHistory"
  ADD CONSTRAINT "RegionalManagerAssignmentHistory_assigned_by_id_fkey"
  FOREIGN KEY ("assigned_by_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RegionalManagerAssignmentHistory"
  ADD CONSTRAINT "RegionalManagerAssignmentHistory_unassigned_by_id_fkey"
  FOREIGN KEY ("unassigned_by_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "HotelManagerAssignmentHistory" (
  "id" TEXT NOT NULL,
  "hotel_id" TEXT NOT NULL,
  "manager_user_id" TEXT NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL,
  "unassigned_at" TIMESTAMP(3),
  "assigned_by_id" TEXT,
  "unassigned_by_id" TEXT,
  "reason" "ManagerVacancyReason",

  CONSTRAINT "HotelManagerAssignmentHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HotelManagerAssignmentHistory_hotel_id_idx" ON "HotelManagerAssignmentHistory"("hotel_id");
CREATE INDEX "HotelManagerAssignmentHistory_manager_user_id_idx" ON "HotelManagerAssignmentHistory"("manager_user_id");

ALTER TABLE "HotelManagerAssignmentHistory"
  ADD CONSTRAINT "HotelManagerAssignmentHistory_hotel_id_fkey"
  FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HotelManagerAssignmentHistory"
  ADD CONSTRAINT "HotelManagerAssignmentHistory_manager_user_id_fkey"
  FOREIGN KEY ("manager_user_id") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HotelManagerAssignmentHistory"
  ADD CONSTRAINT "HotelManagerAssignmentHistory_assigned_by_id_fkey"
  FOREIGN KEY ("assigned_by_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HotelManagerAssignmentHistory"
  ADD CONSTRAINT "HotelManagerAssignmentHistory_unassigned_by_id_fkey"
  FOREIGN KEY ("unassigned_by_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

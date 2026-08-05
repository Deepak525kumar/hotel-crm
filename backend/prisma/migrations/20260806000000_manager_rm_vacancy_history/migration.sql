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

-- Backfill: every HotelGroup existing today already has an RM assigned
-- (the column was NOT NULL until the ALTER above) -- record that assignment
-- as having started at the group's creation, the earliest defensible
-- timestamp available (the true original assignment time was never
-- recorded before this migration).
UPDATE "HotelGroup" SET "regional_manager_assigned_at" = "created_at" WHERE "regional_manager_user_id" IS NOT NULL;

-- ── Hotel: add vacancy fields (manager_user_id was already nullable) ──

ALTER TABLE "Hotel" ADD COLUMN "manager_assigned_at" TIMESTAMP(3);
ALTER TABLE "Hotel" ADD COLUMN "manager_vacated_at" TIMESTAMP(3);
ALTER TABLE "Hotel" ADD COLUMN "manager_vacancy_reason" "ManagerVacancyReason";

-- Backfill: any hotel already carrying a manager_user_id (the PR #348 write
-- path landed same-day) similarly gets its assignment dated from the
-- hotel's own updated_at, the closest available proxy for "when this was
-- last written" (created_at would be wrong -- the assignment happened via a
-- later PATCH, not at creation).
UPDATE "Hotel" SET "manager_assigned_at" = "updated_at" WHERE "manager_user_id" IS NOT NULL;

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

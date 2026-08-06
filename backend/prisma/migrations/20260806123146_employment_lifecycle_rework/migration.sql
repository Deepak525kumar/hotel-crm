-- Employment lifecycle rework (2026-08-06): permanent, non-terminal
-- EmploymentStatus with rehire support. Supersedes the terminal-state design
-- documented at RULE-EMP-02/03/12 (docs/03-modules/employee-management/
-- MODULE_SPEC.md) -- see that doc's accompanying update for the new rules.
--
-- Old enum: INACTIVE, UNDER_REVIEW, ACTIVE, REJECTED, DEACTIVATED.
-- New enum: PENDING, ACTIVE, DEACTIVATED, REJECTED, DELETED.
--
-- Value mapping (verified against every EmploymentRecord.status write path
-- in the codebase before writing this migration -- see PR description):
--   INACTIVE      -> PENDING   (submitted_for_review_at stays NULL)
--   UNDER_REVIEW  -> PENDING   (submitted_for_review_at backfilled to updated_at,
--                                the closest available proxy for "when it was
--                                submitted" -- same class of proxy-timestamp
--                                caveat already accepted in the 20260806000000
--                                manager/RM vacancy-history migration)
--   ACTIVE        -> ACTIVE    (unchanged)
--   REJECTED      -> REJECTED  (unchanged)
--   DEACTIVATED   -> DELETED   (NOT the new DEACTIVATED -- see below)
--
-- Why DEACTIVATED remaps to DELETED, not to the new DEACTIVATED: every write
-- path that has EVER produced status=DEACTIVATED in this codebase
-- (employee-management/service.ts's deactivate() and
-- deactivateForContractLapse(), both pre-rework) always paired it with
-- deleted_at = now() in the same write -- there is no third path and no
-- counterexample. That combination has only ever meant "left the company".
-- The new DEACTIVATED (temporary pause: leave/seasonal/suspension, no
-- deleted_at) is a concept that did not exist before this migration and has
-- no historical instances to preserve -- mapping old DEACTIVATED rows to new
-- DEACTIVATED would misrepresent departed employees as merely on leave.
--
-- Postgres requires the rename-old/create-new/cast/drop-old sequence for an
-- enum value collapse (ALTER TYPE ... ADD VALUE alone cannot remove/remap
-- values). Pattern follows 20260726000000_add_regional_manager_role/down.sql,
-- the closest existing precedent in this repo, extended here with a CASE-based
-- remap since that precedent only ever dropped an unused value.

BEGIN;

  -- ── 1. New columns on EmploymentRecord, added before the enum swap so the
  --      UNDER_REVIEW backfill below can read the pre-cast status value. ──

  ALTER TABLE "EmploymentRecord"
    ADD COLUMN "submitted_for_review_at" TIMESTAMP(3),
    ADD COLUMN "deactivation_reason" TEXT,
    ADD COLUMN "deleted_reason" TEXT,
    ADD COLUMN "employment_cycle" INTEGER NOT NULL DEFAULT 1;

  -- Backfill submitted_for_review_at for rows that were UNDER_REVIEW, before
  -- the enum cast below erases that distinction. updated_at is the closest
  -- available proxy for "when it was submitted for review" -- there is no
  -- transition log to read a precise timestamp from (EmploymentStatusHistory
  -- is created fresh by this same migration, see below).
  UPDATE "EmploymentRecord"
    SET "submitted_for_review_at" = "updated_at"
    WHERE "status" = 'UNDER_REVIEW';

  -- ── 2. Enum value collapse: rename-old, create-new, cast, drop-old. ──

  ALTER TYPE "EmploymentStatus" RENAME TO "EmploymentStatus_old";

  CREATE TYPE "EmploymentStatus" AS ENUM ('PENDING', 'ACTIVE', 'DEACTIVATED', 'REJECTED', 'DELETED');

  ALTER TABLE "EmploymentRecord"
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE "EmploymentStatus"
      USING (
        CASE "status"::text
          WHEN 'INACTIVE'     THEN 'PENDING'
          WHEN 'UNDER_REVIEW' THEN 'PENDING'
          WHEN 'DEACTIVATED'  THEN 'DELETED'
          ELSE "status"::text
        END
      )::"EmploymentStatus",
    ALTER COLUMN "status" SET DEFAULT 'PENDING';

  DROP TYPE "EmploymentStatus_old";

  -- ── 3. New DeactivationReason enum (temporary-pause reasons only; DELETED
  --      uses the free-text deleted_reason column added above instead). ──

  CREATE TYPE "DeactivationReason" AS ENUM ('TEMPORARY_LEAVE', 'SEASONAL', 'SUSPENDED');

  ALTER TABLE "EmploymentRecord"
    ALTER COLUMN "deactivation_reason" TYPE "DeactivationReason"
      USING ("deactivation_reason"::"DeactivationReason");

  -- ── 4. Mirror the DEACTIVATED->DELETED remap onto the linked User row.
  --      Decision: DELETED == deleteUser() (soft-deletes the account too).
  --      A pre-existing DEACTIVATED+deleted_at EmploymentRecord implies the
  --      User should end up soft-deleted as well if it isn't already. Skip
  --      rows whose User is already deleted (idempotent, avoids clobbering
  --      an existing deleted_at with a fresh migration timestamp). ──

  UPDATE "User" u
    SET "deleted_at" = now(), "is_active" = false
    FROM "EmploymentRecord" er
    WHERE er."user_id" = u."id"
      AND er."status" = 'DELETED'
      AND u."deleted_at" IS NULL;

  UPDATE "EmploymentRecord"
    SET "deleted_reason" = 'MIGRATION: remapped from pre-rework DEACTIVATED (always meant "left the company" -- see migration header)'
    WHERE "status" = 'DELETED';

  -- ── 5. EmploymentStatusHistory: append-only lifecycle transition log. ──

  CREATE TABLE "EmploymentStatusHistory" (
    "id" TEXT NOT NULL,
    "employment_record_id" TEXT NOT NULL,
    "from_status" "EmploymentStatus" NOT NULL,
    "to_status" "EmploymentStatus" NOT NULL,
    "reason" TEXT,
    "actor_user_id" TEXT,
    "employment_cycle" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "EmploymentStatusHistory_pkey" PRIMARY KEY ("id")
  );

  ALTER TABLE "EmploymentStatusHistory"
    ADD CONSTRAINT "EmploymentStatusHistory_employment_record_id_fkey"
      FOREIGN KEY ("employment_record_id") REFERENCES "EmploymentRecord"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;

  ALTER TABLE "EmploymentStatusHistory"
    ADD CONSTRAINT "EmploymentStatusHistory_actor_user_id_fkey"
      FOREIGN KEY ("actor_user_id") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;

  CREATE INDEX "EmploymentStatusHistory_employment_record_id_idx" ON "EmploymentStatusHistory"("employment_record_id");
  CREATE INDEX "EmploymentStatusHistory_created_at_idx" ON "EmploymentStatusHistory"("created_at");

  -- Provenance row per remapped record, so the migration itself leaves a
  -- queryable audit trail rather than a silent status change. from_status is
  -- recorded as DELETED (its own new value) since the old EmploymentStatus
  -- type is already dropped by this point in the transaction and 'DEACTIVATED'
  -- means something different now -- the reason text below carries the real
  -- "was DEACTIVATED pre-rework" provenance instead.
  --
  -- Id is deterministic ('migr_' + record id), NOT because cuid() generation
  -- is unavailable in raw SQL (uniqueness alone doesn't need that), but
  -- because down.sql's rollback path re-identifies exactly these
  -- migration-inserted rows by this id pattern. Matching on `reason LIKE
  -- 'MIGRATION%'` or `deleted_reason LIKE 'MIGRATION:%'` would be forgeable:
  -- both are operator-supplied free text (DeleteEmployeeSchema has no
  -- content restriction), so an admin's genuine deletion reason that happens
  -- to start with "MIGRATION" would be misclassified as this remap. The `id`
  -- column is never operator-supplied, so matching on it is safe.
  INSERT INTO "EmploymentStatusHistory"
    ("id", "employment_record_id", "from_status", "to_status", "reason", "actor_user_id", "employment_cycle", "created_at")
  SELECT
    'migr_' || er."id",
    er."id",
    'DELETED'::"EmploymentStatus",
    'DELETED'::"EmploymentStatus",
    'MIGRATION: pre-rework status was DEACTIVATED (always paired with deleted_at, meaning "left the company") -- remapped to DELETED under the new lifecycle model, see migration header',
    NULL,
    1,
    now()
  FROM "EmploymentRecord" er
  WHERE er."status" = 'DELETED'
    AND er."deleted_reason" LIKE 'MIGRATION:%';

COMMIT;

-- Down migration for 20260806123146_employment_lifecycle_rework
--
-- WARNING: this is lossy in one direction. The forward migration collapsed
-- INACTIVE/UNDER_REVIEW into PENDING and remapped DEACTIVATED into DELETED.
-- Reversing the enum swap is mechanical, but:
--   * PENDING rows split back into INACTIVE/UNDER_REVIEW using
--     submitted_for_review_at IS NULL/NOT NULL -- this is recoverable because
--     the forward migration preserved that distinction deliberately.
--   * Rows that are DELETED *because* of the forward migration's remap
--     (identified via the deterministic EmploymentStatusHistory.id it wrote,
--     not the forgeable deleted_reason free text) revert to DEACTIVATED.
--     Rows that became DELETED through genuine post-rework use (a real
--     delete/rehire cycle) CANNOT be distinguished from the former by this
--     point if that cycle also happened to only produce one history row --
--     this is why the guard below enforces employment_cycle = 1 AND exactly
--     one EmploymentStatusHistory row per EmploymentRecord before running
--     this, same precondition-verification spirit as
--     20260726000000_add_regional_manager_role/down.sql's "verify no
--     REGIONAL_MANAGER rows exist" check -- except ENFORCED via RAISE
--     EXCEPTION below, not left as a comment-only warning.

-- No explicit BEGIN/COMMIT here: the migration harness's `down` command
-- already wraps each migration's down.sql in its own transaction (this file
-- is executed via `psql -1 -f down.sql`, or the harness's own transactional
-- runner) -- an explicit BEGIN here produced "WARNING: there is already a
-- transaction in progress" in CI (found 2026-08-06, PR #354's "Forward ·
-- Rollback · Recovery" check). Harmless as a warning by itself, but removed
-- for correctness rather than leaving a misleading no-op statement in place.

  -- Enforced precondition (not just the comment above): abort rather than
  -- silently reverting genuine post-rework departures to DEACTIVATED and
  -- destroying real EmploymentStatusHistory rows with DROP TABLE below. Any
  -- EmploymentRecord with employment_cycle > 1 has been through at least one
  -- real DELETED -> PENDING rehire since the forward migration ran; any
  -- record with more than one EmploymentStatusHistory row has had at least
  -- one real transition beyond the single migration-inserted provenance row.
  -- Same enforced-guard spirit as
  -- 20260726000000_add_regional_manager_role/down.sql's own precondition.
  DO $$
  DECLARE
    cycled_count INTEGER;
    extra_history_count INTEGER;
  BEGIN
    SELECT count(*) INTO cycled_count FROM "EmploymentRecord" WHERE "employment_cycle" > 1;
    IF cycled_count > 0 THEN
      RAISE EXCEPTION
        'Refusing to roll back 20260806123146_employment_lifecycle_rework: % EmploymentRecord row(s) have employment_cycle > 1, meaning a real post-rework rehire has occurred. Rolling back would misclassify a genuine departure as a pre-rework DEACTIVATED remap.',
        cycled_count;
    END IF;

    SELECT count(*) INTO extra_history_count
      FROM (
        SELECT "employment_record_id"
        FROM "EmploymentStatusHistory"
        GROUP BY "employment_record_id"
        HAVING count(*) > 1
      ) AS multi;
    IF extra_history_count > 0 THEN
      RAISE EXCEPTION
        'Refusing to roll back 20260806123146_employment_lifecycle_rework: % EmploymentRecord row(s) have more than one EmploymentStatusHistory row, meaning at least one real post-rework transition has occurred beyond the migration''s own provenance row.',
        extra_history_count;
    END IF;
  END $$;

  -- Revert the DEACTIVATED->DELETED remap for rows the forward migration
  -- itself produced. Identified via the deterministic
  -- EmploymentStatusHistory.id the forward migration wrote ('migr_' + record
  -- id), NOT via deleted_reason's free text -- deleted_reason is
  -- operator-supplied (DeleteEmployeeSchema has no content restriction), so
  -- a genuine admin-authored reason that happens to start with "MIGRATION"
  -- would be forgeable under a text-prefix match. The history row's `id` is
  -- never operator-supplied.
  UPDATE "EmploymentRecord"
    SET "status" = 'DEACTIVATED'
    WHERE "status" = 'DELETED'
      AND "id" IN (
        SELECT "employment_record_id" FROM "EmploymentStatusHistory"
        WHERE "id" = 'migr_' || "employment_record_id"
      );

  ALTER TYPE "EmploymentStatus" RENAME TO "EmploymentStatus_new";

  CREATE TYPE "EmploymentStatus" AS ENUM ('INACTIVE', 'UNDER_REVIEW', 'ACTIVE', 'REJECTED', 'DEACTIVATED');

  ALTER TABLE "EmploymentRecord"
    ALTER COLUMN "status" DROP DEFAULT,
    ALTER COLUMN "status" TYPE "EmploymentStatus"
      USING (
        CASE
          WHEN "status"::text = 'PENDING' AND "submitted_for_review_at" IS NULL THEN 'INACTIVE'
          WHEN "status"::text = 'PENDING' AND "submitted_for_review_at" IS NOT NULL THEN 'UNDER_REVIEW'
          ELSE "status"::text
        END
      )::"EmploymentStatus",
    ALTER COLUMN "status" SET DEFAULT 'INACTIVE';

  -- MUST run before DROP TYPE "EmploymentStatus_new" below: this table's
  -- from_status/to_status columns are still typed as "EmploymentStatus_new"
  -- (only EmploymentRecord.status was cast onto the new "EmploymentStatus"
  -- type above; this table was never altered), so dropping the type first
  -- fails with "cannot drop type ... because other objects depend on it"
  -- (found 2026-08-06 in CI, PR #354's "Forward · Rollback · Recovery"
  -- check -- this exact ordering bug is why that check exists).
  DROP TABLE "EmploymentStatusHistory";

  DROP TYPE "EmploymentStatus_new";

  ALTER TABLE "EmploymentRecord"
    DROP COLUMN "submitted_for_review_at",
    DROP COLUMN "deactivation_reason",
    DROP COLUMN "deleted_reason",
    DROP COLUMN "employment_cycle";

  DROP TYPE "DeactivationReason";

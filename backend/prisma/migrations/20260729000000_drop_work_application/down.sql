-- Down migration for 20260729000000_drop_work_application
--
-- Restores WorkApplication, ApplicationStatus, and
-- WorkerAssignment.application_id to their exact pre-drop shape (schema
-- identical to `20260613120000_v2_marketplace_init`'s original definition,
-- which no later migration modified), then restores row data -- including
-- the reverse WorkerAssignment.application_id pointer -- from the backup
-- table the up-migration created (which snapshots that pointer precisely so
-- this restore is possible; see migration.sql's comment).
--
-- NOT REVERSIBLE BY DESIGN beyond that snapshot: any WorkerAssignment row
-- created AFTER the up-migration ran (PR 9.3 onward, once a replacement
-- creation path exists for that model) was never linked to a
-- WorkApplication and has nothing to restore into application_id. If any
-- such row exists at down-migration time, the final
-- `SET application_id NOT NULL` below fails loudly (fail-closed) rather
-- than silently leaving a nullable column that no longer matches the
-- original schema -- matching `20260727010000_drop_user_permissions`'s
-- down.sql precedent of documenting non-general-case reversibility rather
-- than fabricating data. Running this down.sql is a last-resort rollback
-- path for a window where nothing has yet been created against the
-- post-drop schema, not a supported "undo PR 9.3+" operation.
--
-- The backup table is dropped here, after the restore, so this migration is
-- fully reversible per the migration harness's teardown-to-empty invariant
-- (every migration's down.sql must leave no schema object behind -- see
-- scripts/migrate-harness.sh's `verify`).
BEGIN;

  -- RecreateEnum
  CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

  -- RecreateTable
  CREATE TABLE "WorkApplication" (
      "id" TEXT NOT NULL,
      "work_request_id" TEXT NOT NULL,
      "worker_id" TEXT NOT NULL,
      "reviewed_by_id" TEXT,
      "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
      "cover_note" TEXT,
      "worker_rating_snapshot" DOUBLE PRECISION,
      "reviewed_at" TIMESTAMP(3),
      "rejection_reason" TEXT,
      "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL,

      CONSTRAINT "WorkApplication_pkey" PRIMARY KEY ("id")
  );

  -- RecreateIndex
  CREATE INDEX "WorkApplication_work_request_id_idx" ON "WorkApplication"("work_request_id");
  CREATE INDEX "WorkApplication_worker_id_idx" ON "WorkApplication"("worker_id");
  CREATE INDEX "WorkApplication_status_idx" ON "WorkApplication"("status");
  CREATE INDEX "WorkApplication_applied_at_idx" ON "WorkApplication"("applied_at");
  CREATE UNIQUE INDEX "WorkApplication_work_request_id_worker_id_key" ON "WorkApplication"("work_request_id", "worker_id");

  -- AddForeignKey
  ALTER TABLE "WorkApplication" ADD CONSTRAINT "WorkApplication_work_request_id_fkey" FOREIGN KEY ("work_request_id") REFERENCES "WorkRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "WorkApplication" ADD CONSTRAINT "WorkApplication_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "WorkApplication" ADD CONSTRAINT "WorkApplication_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

  -- Restore WorkApplication's own rows from the pre-drop snapshot.
  INSERT INTO "WorkApplication" (
    "id", "work_request_id", "worker_id", "reviewed_by_id", "status",
    "cover_note", "worker_rating_snapshot", "reviewed_at", "rejection_reason",
    "applied_at", "updated_at"
  )
  SELECT
    "id", "work_request_id", "worker_id", "reviewed_by_id",
    "status"::"ApplicationStatus",
    "cover_note", "worker_rating_snapshot", "reviewed_at", "rejection_reason",
    "applied_at", "updated_at"
  FROM "_WorkApplication_backup_20260729";

  -- AddColumn (nullable first -- populated by the UPDATE below, then made
  -- NOT NULL once populated; see header for the fail-closed guard on any
  -- row this restore cannot cover).
  ALTER TABLE "WorkerAssignment" ADD COLUMN "application_id" TEXT;

  UPDATE "WorkerAssignment" wa
  SET "application_id" = b."id"
  FROM "_WorkApplication_backup_20260729" b
  WHERE b."worker_assignment_id" = wa."id";

  -- Fail-closed: if this fires, at least one WorkerAssignment row was
  -- created after the up-migration dropped application_id and has no
  -- snapshot to restore from -- see header. Reinstating NOT NULL below
  -- would otherwise silently violate the original schema for that row.
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM "WorkerAssignment" WHERE "application_id" IS NULL) THEN
      RAISE EXCEPTION 'down.sql cannot restore application_id for one or more WorkerAssignment rows created after the up-migration ran (no WorkApplication to link to). Manual intervention required before NOT NULL can be reinstated.';
    END IF;
  END $$;

  ALTER TABLE "WorkerAssignment" ALTER COLUMN "application_id" SET NOT NULL;

  -- RecreateIndex
  CREATE UNIQUE INDEX "WorkerAssignment_application_id_key" ON "WorkerAssignment"("application_id");

  -- AddForeignKey
  ALTER TABLE "WorkerAssignment" ADD CONSTRAINT "WorkerAssignment_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "WorkApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

  DROP TABLE "_WorkApplication_backup_20260729";

COMMIT;

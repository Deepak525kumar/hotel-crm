-- Epic 9 PR 9.2 (TREQ-011): drops the marketplace-era WorkApplication table,
-- its ApplicationStatus enum, and WorkerAssignment's mandatory
-- application_id FK. The marketplace "worker applies, manager approves" flow
-- has no route (no apply/list/approve endpoint exists in this repo -- see
-- work-requests/routes.ts) and no remaining code reads WorkApplication as of
-- this PR's service.ts change (work-requests/service.ts getById():
-- `my_application` is now a stubbed, always-null compatibility field for the
-- still-live mobile client, populated from nothing).
--
-- WorkerAssignment.application_id was a mandatory (NOT NULL), unique FK to
-- WorkApplication with the only creator being the now-deleted
-- work-applications/service.ts's approve() -- so WorkerAssignment currently
-- has no create path in this codebase. PR 9.3 repoints this model to a
-- nullable job_request_id with fresh creation paths landing in PR 9.5
-- (calendar) and PR 9.9 (broadcast accept); this migration only removes the
-- old column, it does not add the new one.
--
-- NOT REVERSIBLE BY DESIGN (data loss): dropping WorkApplication also drops
-- every application row (PENDING/ACCEPTED/REJECTED/WITHDRAWN/EXPIRED
-- history). A pre-drop snapshot is retained in a backup table for one
-- release, matching this repo's `20260727010000_drop_user_permissions`
-- precedent. The backup table is NOT dropped by this (up) migration -- it
-- persists across the retention window as an operational/deployment policy;
-- see down.sql for why it IS dropped there.
--
-- Column types are snapshotted verbatim (including the enum column, cast to
-- text for the same reason `20260727010000_drop_user_permissions` casts
-- User.role to text: a live enum dependency on the backup table would block
-- a later migration's `DROP TYPE "ApplicationStatus"` -- specifically this
-- same migration's own down.sql, which must recreate and then be able to
-- drop that type again on a second down/up cycle).
--
-- The reverse WorkerAssignment.application_id pointer is snapshotted
-- alongside each application's own row (a plain LEFT JOIN on the 1:1 unique
-- FK, so this is a single backup table, not two) precisely so the down
-- migration can restore that column's values, not just WorkApplication's
-- rows -- otherwise the original NOT NULL constraint on
-- WorkerAssignment.application_id could never be safely reinstated.
CREATE TABLE "_WorkApplication_backup_20260729" AS
  SELECT
    wap."id",
    wap."work_request_id",
    wap."worker_id",
    wap."reviewed_by_id",
    wap."status"::text AS "status",
    wap."cover_note",
    wap."worker_rating_snapshot",
    wap."reviewed_at",
    wap."rejection_reason",
    wap."applied_at",
    wap."updated_at",
    wa."id" AS "worker_assignment_id",
    now() AS "snapshotted_at"
  FROM "WorkApplication" wap
  LEFT JOIN "WorkerAssignment" wa ON wa."application_id" = wap."id";

-- DropForeignKey (WorkerAssignment.application_id -> WorkApplication.id)
ALTER TABLE "WorkerAssignment" DROP CONSTRAINT "WorkerAssignment_application_id_fkey";

-- DropIndex (unique index backing the 1:1 WorkerAssignment<->WorkApplication link)
DROP INDEX "WorkerAssignment_application_id_key";

-- DropColumn
ALTER TABLE "WorkerAssignment" DROP COLUMN "application_id";

-- DropForeignKey (WorkApplication's own FKs, ahead of dropping the table)
ALTER TABLE "WorkApplication" DROP CONSTRAINT "WorkApplication_work_request_id_fkey";
ALTER TABLE "WorkApplication" DROP CONSTRAINT "WorkApplication_worker_id_fkey";
ALTER TABLE "WorkApplication" DROP CONSTRAINT "WorkApplication_reviewed_by_id_fkey";

-- DropTable
DROP TABLE "WorkApplication";

-- DropEnum
DROP TYPE "ApplicationStatus";

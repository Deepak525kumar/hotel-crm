-- Merge Rating into QualityVerification (owner decision, 2026-08-29:
-- "why is our system creating rating and check. it should only have check").
--
-- One inspection visit wrote TWO rows against the same assignment, both
-- carrying a 0-100 score and the same photographs. The only thing Rating held
-- that QualityVerification did not was the checklist (criteria_scores), and
-- the only thing it made cheaper was filtering by worker_id.
--
-- Order matters: every column is added and BACKFILLED before anything is
-- dropped, so the transaction either produces a complete QualityVerification
-- for every historical inspection or fails leaving Rating intact.

-- 1. The two columns QualityVerification lacks.
--
-- IF NOT EXISTS because at least one developer database carries a
-- `criteria_scores` column from a migration that exists in that database and
-- not in this repository (20260824223717_add_verification_criteria_scores).
-- Production was checked directly on 2026-08-29 and has NEITHER column, so
-- this is defensive rather than load-bearing there -- but a migration that
-- aborts on the first developer to run it is a migration nobody runs.
ALTER TABLE "QualityVerification" ADD COLUMN IF NOT EXISTS "criteria_scores" JSONB;
ALTER TABLE "QualityVerification" ADD COLUMN IF NOT EXISTS "worker_id" TEXT;

-- 2. worker_id for rows that already exist, read through the assignment.
--    Every QualityVerification has one (assignment_id is NOT NULL with a
--    cascade), so this leaves no NULLs behind.
UPDATE "QualityVerification" v
SET "worker_id" = a."worker_id"
FROM "WorkerAssignment" a
WHERE a."id" = v."assignment_id";

-- 3. Carry the checklist across where both rows describe the same shift.
UPDATE "QualityVerification" v
SET "criteria_scores" = r."criteria_scores"
FROM "Rating" r
WHERE r."assignment_id" = v."assignment_id"
  AND r."criteria_scores" IS NOT NULL;

-- 4. Ratings whose shift has NO verification would otherwise be deleted with
--    the table. Promote each to a QualityVerification so no historical
--    inspection is lost -- this is the step that makes the merge
--    non-destructive rather than a drop.
--
--    `status` is derived from the score using the same thresholds
--    createVerification applies (>=70 PASSED, >=40 NEEDS_REWORK, else FAILED),
--    so a promoted row is indistinguishable from one recorded natively.
--    `notes` takes Rating.comment, which is the same field by another name.
INSERT INTO "QualityVerification" (
  "id", "assignment_id", "hotel_id", "verified_by_id", "worker_id",
  "score", "status", "notes", "criteria_scores", "photo_urls",
  "rework_required", "created_at", "updated_at"
)
SELECT
  r."id",
  r."assignment_id",
  r."hotel_id",
  r."rated_by_id",
  r."worker_id",
  r."score",
  CASE
    WHEN r."score" >= 70 THEN 'PASSED'::"VerificationStatus"
    WHEN r."score" >= 40 THEN 'NEEDS_REWORK'::"VerificationStatus"
    ELSE 'FAILED'::"VerificationStatus"
  END,
  r."comment",
  r."criteria_scores",
  r."photo_urls",
  FALSE,
  r."created_at",
  r."updated_at"
FROM "Rating" r
LEFT JOIN "QualityVerification" v ON v."assignment_id" = r."assignment_id"
WHERE v."id" IS NULL;

-- 5. Now that every row has one, worker_id is required.
ALTER TABLE "QualityVerification" ALTER COLUMN "worker_id" SET NOT NULL;

ALTER TABLE "QualityVerification"
  DROP CONSTRAINT IF EXISTS "QualityVerification_worker_id_fkey";
ALTER TABLE "QualityVerification"
  ADD CONSTRAINT "QualityVerification_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The reads these replace: refreshWorkerOverallRating's recency window
-- (WHERE worker_id = ? ORDER BY created_at DESC LIMIT 10) and the analytics
-- per-worker aggregates. Rating carried the equivalents; without them both
-- degrade to a scan on a table that only grows.
CREATE INDEX IF NOT EXISTS "QualityVerification_worker_id_idx" ON "QualityVerification"("worker_id");
CREATE INDEX IF NOT EXISTS "QualityVerification_worker_id_created_at_idx" ON "QualityVerification"("worker_id", "created_at");

-- 6. Rating is now fully represented. Its FKs go with it.
DROP TABLE "Rating";

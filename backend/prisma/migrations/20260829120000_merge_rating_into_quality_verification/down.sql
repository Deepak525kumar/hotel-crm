-- Reverses the schema. It CANNOT reverse the data, and that distinction
-- matters: after the merge there is no way to tell a QualityVerification that
-- was always a check from one promoted out of a Rating in the up migration's
-- step 4. Rebuilding "Rating" from the merged table would either fabricate
-- rows for native checks or silently drop the promoted ones.
--
-- So this restores the SHAPE, leaving "Rating" empty. Recovering the rows
-- means restoring from a backup taken before the up migration ran. The
-- migration harness (scripts/migrate-harness.sh) exercises this on an empty
-- database, where shape is the whole story; production is not empty, and
-- rolling back there loses the checklist and photo history that moved across.

-- 1. Rebuild the table exactly as 20260613120000_v2_marketplace_init left it,
--    plus photo_urls from 20260824211701_add_rating_photo_evidence.
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "rated_by_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "criteria_scores" JSONB,
    "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- The CHECK the table carried when it was dropped. 20260613120000 created it
-- at 1-5 stars and 20260722180000 widened it to 0-100; recreating the table
-- without it makes THAT migration's own down.sql fail on the way past, because
-- it drops a constraint that would not exist. A rollback chain is only as
-- reversible as its least faithful link.
ALTER TABLE "Rating"
  ADD CONSTRAINT "Rating_score_range"
  CHECK ("score" >= 0 AND "score" <= 100);

CREATE UNIQUE INDEX "Rating_assignment_id_key" ON "Rating"("assignment_id");
CREATE INDEX "Rating_hotel_id_idx" ON "Rating"("hotel_id");
CREATE INDEX "Rating_worker_id_idx" ON "Rating"("worker_id");
CREATE INDEX "Rating_rated_by_id_idx" ON "Rating"("rated_by_id");
CREATE INDEX "Rating_score_idx" ON "Rating"("score");
CREATE INDEX "Rating_created_at_idx" ON "Rating"("created_at");
CREATE INDEX "Rating_worker_id_created_at_idx" ON "Rating"("worker_id", "created_at");

ALTER TABLE "Rating" ADD CONSTRAINT "Rating_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "WorkerAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_hotel_id_fkey"
  FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_rated_by_id_fkey"
  FOREIGN KEY ("rated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Undo what the merge added to QualityVerification.
DROP INDEX IF EXISTS "QualityVerification_worker_id_created_at_idx";
DROP INDEX IF EXISTS "QualityVerification_worker_id_idx";
ALTER TABLE "QualityVerification" DROP CONSTRAINT IF EXISTS "QualityVerification_worker_id_fkey";
ALTER TABLE "QualityVerification" DROP COLUMN IF EXISTS "worker_id";
ALTER TABLE "QualityVerification" DROP COLUMN IF EXISTS "criteria_scores";

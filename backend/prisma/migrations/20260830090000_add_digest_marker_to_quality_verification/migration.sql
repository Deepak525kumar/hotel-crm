-- Owner decision (2026-08-30): a checker now writes up to ~100 checks per
-- shift, one per room. Pushing every one at the worker trains them to turn
-- notifications off, which silently kills the rework alerts that matter.
-- Rework pushes immediately; everything else arrives as ONE end-of-shift
-- digest. This column is what makes that digest send exactly once.
--
-- Nullable with no backfill: NULL means "not yet digested". Checks that
-- already exist were pushed individually under the old policy, so leaving
-- them NULL would re-summarize history on the first tick after deploy. They
-- are stamped as already-digested below, and only rows written from here on
-- start life NULL.
ALTER TABLE "QualityVerification" ADD COLUMN "digest_notified_at" TIMESTAMP(3);

-- Everything that exists now has already been notified under the per-check
-- policy. Stamp it with its own created_at rather than now(): the value is
-- "when the worker was told", and they were told when the check was written.
UPDATE "QualityVerification" SET "digest_notified_at" = "created_at";

-- The job's scan predicate, in column order: undigested first (the selective
-- one -- almost every row is digested), then non-rework, then the quiet-period
-- cutoff on created_at. Without this the job sequentially scans every check
-- ever written, on every tick, forever.
CREATE INDEX "QualityVerification_digest_notified_at_rework_required_creat_idx"
  ON "QualityVerification" ("digest_notified_at", "rework_required", "created_at");

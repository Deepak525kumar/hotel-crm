-- ADR-026 (corrected 2026-07-22, OQ-01): Rating.score rescaled from 1-5 stars to
-- 0-100 to match CONFIRMED_REQUIREMENTS_REGISTER.md §15/TRULE-001 exactly. This is
-- implementation of the already-confirmed requirement, not an override of it.
--
-- Order matters: relax the CHECK constraint BEFORE rescaling existing rows (the
-- ×20 values would otherwise violate the old [1,5] bound mid-migration), then
-- tighten it to the new [0,100] bound once every row is in range.
--
-- Linear mapping preserves each existing rating's relative meaning:
--   1 star -> 20, 2 -> 40, 3 -> 60, 4 -> 80, 5 stars -> 100.
--
-- WorkerOverallRating.average_score requires no separate fix: it is maintained by
-- the existing AFTER INSERT OR UPDATE OR DELETE trigger (Rating_refresh_overall_rating,
-- see 20260613120000_v2_marketplace_init/migration.sql:588-631), which recomputes
-- AVG("score") with no hardcoded 1-5 assumption. The UPDATE below fires that trigger
-- once per affected row, so every worker's aggregate is refreshed automatically as
-- part of this migration.

-- 1. Relax the CHECK constraint to admit the widened domain before any row is rescaled.
ALTER TABLE "Rating" DROP CONSTRAINT "Rating_score_range";
ALTER TABLE "Rating"
  ADD CONSTRAINT "Rating_score_range"
  CHECK ("score" >= 0 AND "score" <= 100);

-- 2. Rescale existing rows. Guarded by the pre-migration domain (<=5) so this
--    migration is safe to run at most once against a given row; already-rescaled
--    rows (score > 5) are left untouched, making the statement idempotent.
UPDATE "Rating" SET "score" = "score" * 20 WHERE "score" <= 5;

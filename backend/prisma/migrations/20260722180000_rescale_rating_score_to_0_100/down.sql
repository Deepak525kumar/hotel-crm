-- Down migration for 20260722180000_rescale_rating_score_to_0_100
--
-- Reverses the ×20 rescale for rows that are still exact multiples of 20 in
-- [20,100] (i.e. have not been re-rated on the 0-100 scale since the up
-- migration ran) and restores the [1,5] CHECK constraint. Any row with a score
-- that is not a multiple of 20, or falls outside [20,100], was created or
-- edited under the new 0-100 domain and cannot be losslessly mapped back to a
-- 1-5 value — verify no such rows exist before running this in an environment
-- where new ratings may have been written post-migration.
BEGIN;

  UPDATE "Rating" SET "score" = "score" / 20 WHERE "score" >= 20 AND "score" <= 100 AND "score" % 20 = 0;

  ALTER TABLE "Rating" DROP CONSTRAINT "Rating_score_range";
  ALTER TABLE "Rating"
    ADD CONSTRAINT "Rating_score_range"
    CHECK ("score" >= 1 AND "score" <= 5);

COMMIT;

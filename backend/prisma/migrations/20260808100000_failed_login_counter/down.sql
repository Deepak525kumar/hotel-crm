-- Down migration for 20260808100000_failed_login_counter
--
-- Both columns are additive (default 0 / nullable), so reverting is a plain
-- drop -- no data-loss guard needed beyond the counters' own content.
ALTER TABLE "User" DROP COLUMN "failed_login_since";
ALTER TABLE "User" DROP COLUMN "failed_login_count";

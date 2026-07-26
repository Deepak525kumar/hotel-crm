-- Down migration for 20260726010000_add_user_token_generation
--
-- Additive-only up migration (new column, no backfill) -- reversal drops it.
-- Safe at any point before ADR-031 PR-3 enables enforcement (the column is
-- unread until then); after PR-3, dropping it reintroduces the pre-ADR-031
-- no-revocation behavior for any in-flight request that reads it.
BEGIN;

  ALTER TABLE "User" DROP COLUMN "token_generation";

COMMIT;

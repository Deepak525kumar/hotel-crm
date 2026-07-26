-- Down migration for 20260727000000_add_password_reset_token_used_at_index
--
-- Additive-only up migration (new index, no data change) -- reversal drops
-- it. Always safe: the sweep query still runs correctly without the index,
-- just with the pre-existing (unmitigated) scan-cost risk (F-1) restored.
BEGIN;

  DROP INDEX "PasswordResetToken_used_at_idx";

COMMIT;

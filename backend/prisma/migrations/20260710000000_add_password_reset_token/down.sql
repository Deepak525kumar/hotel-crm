-- Down migration for 20260710000000_add_password_reset_token
-- Reverses HOTFIX-AUTH-002 (SIR-AUTH-001): drops the PasswordResetToken table.
-- CASCADE removes its indexes and the User foreign-key constraint with it.
-- Idempotent (IF EXISTS) so a partially applied forward migration can still be
-- rolled back.
--
-- Paired-down convention: every forward migration ships a sibling `down.sql`.
-- See backend/scripts/migrate-harness.sh.

DROP TABLE IF EXISTS "PasswordResetToken" CASCADE;

-- Down migration for 20260724120000_add_push_token
--
-- Additive-only up migration (new table + new enum type, no existing
-- column/constraint touched) -- reversal is a straight drop. All registered
-- push tokens are lost; devices simply re-register on next app launch.
BEGIN;

  DROP TABLE "PushToken";

  DROP TYPE "PushPlatform";

COMMIT;

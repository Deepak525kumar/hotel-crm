-- Down migration for 20260724220000_add_push_app
--
-- Additive-only up migration (new enum type + new column) -- reversal drops
-- both. Any registered app attribution is lost; devices simply re-register on
-- next app launch, exactly as for the PushToken table itself.
BEGIN;

  ALTER TABLE "PushToken" DROP COLUMN "app";

  DROP TYPE "PushApp";

COMMIT;

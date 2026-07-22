-- Down migration for 20260722143000_epic7_notif_channel_webhook
--
-- PostgreSQL does not support DROP VALUE for an enum type. Reverting requires
-- recreating the type without WEBHOOK, which is only safe if no row uses it.
-- Provided for completeness/documentation; verify no Notification.channel =
-- 'WEBHOOK' rows exist before running.
BEGIN;

  ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";

  CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH', 'SMS');

  ALTER TABLE "Notification"
    ALTER COLUMN "channel" DROP DEFAULT,
    ALTER COLUMN "channel" TYPE "NotificationChannel"
      USING ("channel"::text::"NotificationChannel"),
    ALTER COLUMN "channel" SET DEFAULT 'IN_APP';

  DROP TYPE "NotificationChannel_old";

COMMIT;

-- Down migration for 20260805040000_add_assignments_outbox_module
--
-- PostgreSQL does not support DROP VALUE for an enum type. Reverting requires
-- recreating the type without the new value, which is only safe if no row
-- uses it. Verify no OutboxEvent.source_module = 'ASSIGNMENTS' rows exist
-- before running this.
BEGIN;

  ALTER TYPE "OutboxSourceModule" RENAME TO "OutboxSourceModule_old";
  CREATE TYPE "OutboxSourceModule" AS ENUM (
    'WORK_REQUESTS', 'WORK_APPLICATIONS', 'ATTENDANCE', 'QUALITY', 'CALENDAR',
    'DOCUMENTS', 'HR', 'CONSENT', 'AUTH'
  );
  ALTER TABLE "OutboxEvent"
    ALTER COLUMN "source_module" TYPE "OutboxSourceModule" USING ("source_module"::text::"OutboxSourceModule");
  DROP TYPE "OutboxSourceModule_old";

COMMIT;

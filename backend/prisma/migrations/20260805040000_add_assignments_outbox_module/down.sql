-- Down migration for 20260805040000_add_assignments_outbox_module
--
-- PostgreSQL does not support DROP VALUE for an enum type. Reverting requires
-- recreating the type without the new value, which is only safe if no row
-- uses it. Verify no OutboxEvent.source_module = 'ASSIGNMENTS' rows exist
-- before running this.
--
-- Migration-harness finding (2026-08-05): schema.prisma lists DOCUMENTS and
-- AUTH on this enum, but no migration in this repo's history ever adds
-- either via ALTER TYPE ... ADD VALUE (grepped the full migrations/
-- directory -- confirmed absent). A from-scratch `prisma migrate deploy`
-- therefore does NOT produce those two values, even though application code
-- (auth/service.ts) writes OutboxSourceModule.AUTH -- a real, pre-existing
-- drift between schema.prisma and the actual migration chain, caught by the
-- harness's rollback+recovery diff when this down.sql was first exercised.
-- Out of scope to fix retroactively here (that needs its own migration
-- adding the missing ALTER TYPE ADD VALUE statements); this down.sql
-- reconstructs the type to match what the migration chain ACTUALLY
-- produces, not what schema.prisma claims, so rollback+recovery matches
-- reality instead of perpetuating the drift.
BEGIN;

  ALTER TYPE "OutboxSourceModule" RENAME TO "OutboxSourceModule_old";
  CREATE TYPE "OutboxSourceModule" AS ENUM (
    'WORK_REQUESTS', 'WORK_APPLICATIONS', 'ATTENDANCE', 'QUALITY', 'CALENDAR',
    'HR', 'CONSENT'
  );
  ALTER TABLE "OutboxEvent"
    ALTER COLUMN "source_module" TYPE "OutboxSourceModule" USING ("source_module"::text::"OutboxSourceModule");
  DROP TYPE "OutboxSourceModule_old";

COMMIT;

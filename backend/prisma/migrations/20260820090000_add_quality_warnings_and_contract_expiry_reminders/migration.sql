-- Repairs schema drift shipped by PR #498 ("Worker quality threshold warnings,
-- leaderboard visibility, and contract expiry reminders", e958399).
--
-- That PR added three sets of fields to schema.prisma and no migration for any
-- of them. The drift is invisible on a developer machine whose database was
-- built by `prisma db push` or predates the change, and it is invisible in CI
-- because the backend suite mocks Prisma on these paths -- but on any database
-- built from the migration history (staging, production, a fresh CI database)
-- the columns simply do not exist.
--
-- The failure is not subtle once it happens. refreshWorkerOverallRating()
-- reads WorkerOverallRating via findUnique, which selects every column the
-- schema declares, so it raises P2022 the moment it runs -- and it runs on
-- every rating creation, every assignment status change, and every rework
-- completion. Rating a worker fails outright.
--
-- Verified against a database migrated purely from prisma/migrations:
--   npx prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel prisma/schema.prisma --script
-- reported exactly the statements below. This migration is that diff, not a
-- hand-written guess at it.

-- AlterEnum
-- Separate statements, one value each: PostgreSQL 11 and earlier cannot add
-- more than one enum value in a single migration, and this repo's own
-- 20260818130000_add_rework_notification_types set that precedent.
-- IF NOT EXISTS is required, not cosmetic. The migration harness rolls the
-- newest migration back and then re-applies it, and down.sql cannot remove an
-- enum label (PostgreSQL has no ALTER TYPE ... DROP VALUE) without rebuilding
-- the whole type. Without the guard the re-apply fails with 42710
-- "enum label already exists" -- which is exactly how CI caught this.
-- Matches the precedent in 20260818130000_add_rework_notification_types.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'QUALITY_RATING_WARNING_70';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'QUALITY_RATING_WARNING_50';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'HR_CONTRACT_EXPIRY_WORKER_REMINDER';

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "contract_pdf_s3_key" TEXT,
ADD COLUMN     "last_worker_expiry_reminder_at" TIMESTAMP(3),
ADD COLUMN     "worker_expiry_reminder_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "WorkerOverallRating" ADD COLUMN     "warning_50_sent_at" TIMESTAMP(3),
ADD COLUMN     "warning_70_sent_at" TIMESTAMP(3);

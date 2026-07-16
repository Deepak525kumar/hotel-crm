-- Down migration for 20260613120000_v2_marketplace_init
-- Reverses the marketplace init migration: drops every table and enum type it
-- created, returning the schema to empty. Tables are dropped with CASCADE so
-- their indexes and foreign-key constraints are removed with them and drop
-- order does not matter. This script is idempotent (IF EXISTS) so a partially
-- applied forward migration can still be fully rolled back.
--
-- Paired-down convention: every forward migration in this repository ships a
-- sibling `down.sql`. See backend/scripts/migrate-harness.sh and
-- docs/11-deployment/ci-cd/MIGRATION_ROLLBACK_HARNESS.md.

-- Drop the leaderboard trigger and its functions (the forward migration creates
-- refresh_worker_overall_rating / trg_rating_refresh_overall and the
-- Rating_refresh_overall_rating trigger). Dropping the "Rating" table below with
-- CASCADE removes the trigger, but the two standalone functions are independent
-- schema objects and must be dropped explicitly, otherwise a full teardown does
-- not return the schema to empty.
DROP TRIGGER IF EXISTS "Rating_refresh_overall_rating" ON "Rating";
DROP FUNCTION IF EXISTS trg_rating_refresh_overall();
DROP FUNCTION IF EXISTS refresh_worker_overall_rating(TEXT);

-- Drop tables (CASCADE removes their indexes and FK constraints).
DROP TABLE IF EXISTS "AuditLog" CASCADE;
DROP TABLE IF EXISTS "Notification" CASCADE;
DROP TABLE IF EXISTS "WorkerOverallRating" CASCADE;
DROP TABLE IF EXISTS "Rating" CASCADE;
DROP TABLE IF EXISTS "QualityVerification" CASCADE;
DROP TABLE IF EXISTS "Attendance" CASCADE;
DROP TABLE IF EXISTS "WorkerAssignment" CASCADE;
DROP TABLE IF EXISTS "WorkApplication" CASCADE;
DROP TABLE IF EXISTS "WorkRequest" CASCADE;
DROP TABLE IF EXISTS "HotelWorker" CASCADE;
DROP TABLE IF EXISTS "Hotel" CASCADE;
DROP TABLE IF EXISTS "Session" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;

-- Drop enum types (after the tables that referenced them).
DROP TYPE IF EXISTS "NotificationType";
DROP TYPE IF EXISTS "NotificationChannel";
DROP TYPE IF EXISTS "VerificationStatus";
DROP TYPE IF EXISTS "AttendanceStatus";
DROP TYPE IF EXISTS "AssignmentStatus";
DROP TYPE IF EXISTS "ApplicationStatus";
DROP TYPE IF EXISTS "WorkRequestStatus";
DROP TYPE IF EXISTS "HotelWorkerStatus";
DROP TYPE IF EXISTS "UserRole";

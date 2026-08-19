-- Paired rollback (repo convention: every migration ships a down.sql).
--
-- Columns drop cleanly. The enum does not: PostgreSQL has no
-- `ALTER TYPE ... DROP VALUE`, so removing the three added values means
-- rebuilding the type. Rebuilding an enum requires listing its values in
-- INSERTION order -- getting that order wrong silently reassigns every
-- existing NotificationType row to the wrong label rather than erroring, so
-- the list below must be regenerated from the live type rather than retyped
-- from memory:
--
--   SELECT unnest(enum_range(NULL::"NotificationType"));
--
-- Because that ordering is environment-specific and this rollback is the
-- unlikely path, the enum values are deliberately LEFT IN PLACE. An unused
-- enum value is inert -- nothing reads it once the code that emitted it is
-- gone -- whereas a mis-ordered rebuild is silent data corruption across the
-- whole notification history. Dropping the columns is what actually reverses
-- the schema change.

ALTER TABLE "WorkerOverallRating" DROP COLUMN IF EXISTS "warning_50_sent_at";
ALTER TABLE "WorkerOverallRating" DROP COLUMN IF EXISTS "warning_70_sent_at";

ALTER TABLE "Contract" DROP COLUMN IF EXISTS "contract_pdf_s3_key";
ALTER TABLE "Contract" DROP COLUMN IF EXISTS "last_worker_expiry_reminder_at";
ALTER TABLE "Contract" DROP COLUMN IF EXISTS "worker_expiry_reminder_count";

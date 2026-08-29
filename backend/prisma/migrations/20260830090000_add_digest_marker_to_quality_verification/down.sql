-- Real rollback, not a note saying one is impossible: the repository's
-- Forward - Rollback - Recovery harness tears the whole chain to empty and
-- requires 0 relations at the end, so a comment-only down.sql fails CI two
-- migrations later rather than here.
--
-- Dropping the column loses only the record of which checks were summarized.
-- That is recoverable by re-deriving it (the forward migration stamps every
-- existing row), and the digest job does not exist in the rolled-back code.
DROP INDEX IF EXISTS "QualityVerification_digest_notified_at_rework_required_crea_idx";
ALTER TABLE "QualityVerification" DROP COLUMN IF EXISTS "digest_notified_at";

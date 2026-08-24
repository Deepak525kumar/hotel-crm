-- Paired rollback (repo convention: every migration ships a down.sql).
--
-- Purely additive, so the rollback is a single column drop. No enum was
-- created or altered.
--
-- Data loss is intended and bounded: this discards the per-item inspection
-- checklist (TREQ-005 / CRR §15) recorded against each QualityVerification.
-- The headline 0-100 score, the notes and the photo evidence all live in
-- other columns and are unaffected, so an inspection remains readable after a
-- rollback — it just loses its itemised breakdown.
--
-- Rolling this back does NOT break the write path: criteria_scores is
-- optional on CreateQualityVerificationSchema, so a client that still sends
-- it simply has the field ignored once the column is gone. Code and schema
-- can therefore be rolled back independently, unlike the Rating photo column.

ALTER TABLE "QualityVerification" DROP COLUMN IF EXISTS "criteria_scores";

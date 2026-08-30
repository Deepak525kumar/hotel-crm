-- The flat mirror columns on QualityVerification were never dropped, so the
-- rolled-back code reads exactly what it read before: rework_required,
-- rework_notes, rework_completed_at and rework_escalated_at still describe the
-- newest round.
--
-- What is lost is the per-round history and each round's separated photos --
-- which is precisely the information that did not exist before this migration.
-- Rounds beyond the first cannot be represented by the old shape at all.
DROP TABLE IF EXISTS "ReworkRound";

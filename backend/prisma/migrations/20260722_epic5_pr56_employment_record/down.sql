-- Down migration for 20260722_epic5_pr56_employment_record
-- Reverses Epic 5 PR 5.6 (SPEC-EMP-001 employment-record build): drops the two
-- additive tables (their FK constraints/indexes go with them via CASCADE) and
-- the two additive enum types. The back-relation fields added to User/Hotel/
-- HotelGroup in schema.prisma are Prisma-level virtual relations, not DB
-- columns, so there is nothing to drop for them here.
--
-- Child table (EmployeeBlocklistEntry) is dropped before its parent
-- (EmploymentRecord); the enum types are dropped after the table that uses
-- them. Safe because this migration is unread — no consumer repoint or roster
-- migration has shipped (Execution Plan §8; consumer cutover is PR 5.7/5.8).
-- Idempotent (IF EXISTS) so a partially applied forward migration can still be
-- rolled back.
--
-- Paired-down convention: every forward migration ships a sibling `down.sql`.
-- See backend/scripts/migrate-harness.sh.

DROP TABLE IF EXISTS "EmployeeBlocklistEntry" CASCADE;
DROP TABLE IF EXISTS "EmploymentRecord" CASCADE;

DROP TYPE IF EXISTS "SkillTag";
DROP TYPE IF EXISTS "EmploymentStatus";

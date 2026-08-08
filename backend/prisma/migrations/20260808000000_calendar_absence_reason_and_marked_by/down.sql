-- Down migration for 20260808000000_calendar_absence_reason_and_marked_by
--
-- Both columns are additive/nullable (see migration.sql), so reverting is a
-- plain drop -- no data-loss guard needed beyond the columns' own content.
ALTER TABLE "CalendarAbsence" DROP CONSTRAINT "CalendarAbsence_marked_by_id_fkey";
DROP INDEX "CalendarAbsence_marked_by_id_idx";
ALTER TABLE "CalendarAbsence" DROP COLUMN "marked_by_id";
ALTER TABLE "CalendarAbsence" DROP COLUMN "reason";

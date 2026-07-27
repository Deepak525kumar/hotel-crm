-- Down migration for 20260727040000_add_calendar_absence
BEGIN;
  DROP TABLE "CalendarAbsence";
  DROP TYPE "CalendarAbsenceKind";
COMMIT;

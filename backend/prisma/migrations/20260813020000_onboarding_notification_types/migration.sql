-- Onboarding lifecycle notifications (ADR-065, 2026-08-13). Until now
-- employee-management sent no notifications at all: a reviewer had to poll
-- the Review Queue to notice a submission, and an applicant had to keep
-- reopening My Onboarding to learn whether they were approved.
--
-- One value per statement: Postgres < 12 cannot add multiple enum values in a
-- single migration, and this repo's own 20260811122839 migration documents
-- hitting exactly that limitation.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ONBOARDING_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ONBOARDING_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ONBOARDING_REJECTED';

-- Outbox source-module tag for the same onboarding events. Distinct from
-- WORK_APPLICATIONS, which tags job-application events rather than
-- employment-onboarding ones.
ALTER TYPE "OutboxSourceModule" ADD VALUE IF NOT EXISTS 'EMPLOYEE_MANAGEMENT';

-- GD-05: per-hotel "pause new jobs" toggle (REQ-CRM-008). Additive, reversible.
ALTER TABLE "Hotel" ADD COLUMN "accepting_jobs" BOOLEAN NOT NULL DEFAULT true;

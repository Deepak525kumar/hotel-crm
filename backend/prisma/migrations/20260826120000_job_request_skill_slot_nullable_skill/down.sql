-- Down migration for 20260826120000_job_request_skill_slot_nullable_skill

-- Guarded pre-check, mirroring 20260806000000_manager_rm_vacancy_history's
-- own pattern: re-tightening to NOT NULL fails outright (with an unhelpful
-- generic error) if any "no specific skill required" (skill IS NULL) slot
-- was created while this migration was live. Surface which slots first, so
-- a human can resolve them (assign a real skill, or delete the slot) before
-- re-running the rollback, rather than deploy failing on an opaque Postgres
-- message.
DO $$
DECLARE
  offending TEXT;
BEGIN
  SELECT string_agg(id, ', ')
  INTO offending
  FROM "JobRequestSkillSlot"
  WHERE "skill" IS NULL;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot roll back job_request_skill_slot_nullable_skill: JobRequestSkillSlot row(s) % have skill IS NULL ("no specific skill required"), which the pre-migration schema cannot represent. Assign a real skill to each, or delete the row, before rolling back.', offending;
  END IF;
END $$;

ALTER TABLE "JobRequestSkillSlot" ALTER COLUMN "skill" SET NOT NULL;

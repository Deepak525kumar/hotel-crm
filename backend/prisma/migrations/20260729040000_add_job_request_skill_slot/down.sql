-- Down migration for 20260729040000_add_job_request_skill_slot
--
-- Pure additive table, no other schema object touched -- safe and
-- immediate to reverse (no data-loss risk beyond losing the
-- JobRequestSkillSlot rows themselves, which is expected of any
-- down-migration for a newly-added table). Unlike PR 9.5's down.sql, there
-- is no fail-closed guard needed here: no pre-existing column's nullability
-- was relaxed, so there is nothing that could fail to reinstate.
BEGIN;

  ALTER TABLE "JobRequestSkillSlot" DROP CONSTRAINT "JobRequestSkillSlot_headcount_check";
  ALTER TABLE "JobRequestSkillSlot" DROP CONSTRAINT "JobRequestSkillSlot_confirmed_count_check";
  ALTER TABLE "JobRequestSkillSlot" DROP CONSTRAINT "JobRequestSkillSlot_job_request_id_fkey";

  DROP INDEX "JobRequestSkillSlot_skill_idx";
  DROP INDEX "JobRequestSkillSlot_job_request_id_idx";

  DROP TABLE "JobRequestSkillSlot";

COMMIT;

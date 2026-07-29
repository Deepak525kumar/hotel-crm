-- Epic 9 PR 9.7 (TREQ-002/TREQ-003/TREQ-010, MIG-GAP-04/05): adds the
-- JobRequestSkillSlot table -- one row per skill x headcount line on a
-- broadcast JobRequest raised via raiseBroadcast() (e.g. "2 Cleaners + 1
-- Waiter" is two rows on the same job_request_id), per
-- CONFIRMED_REQUIREMENTS_REGISTER.md §13's confirmed shape.
--
-- Purely additive: no existing JobRequest column is touched, no backfill --
-- broadcast is new capability, not a repurposed existing field. `position`/
-- `workers_needed`/`workers_confirmed` on JobRequest are left exactly as-is
-- for the pre-existing marketplace publish/apply flow (still live until
-- TREQ-011's removal, out of this PR's scope) and analytics/service.ts's
-- existing aggregate over those columns -- confirmed by architecture review
-- before this PR's implementation.
--
-- `confirmed_count` defaults to 0 and is unused by this PR's own
-- eligibility-only logic; it is included now so PR 9.9's first-accept
-- arbitration has a per-skill optimistic-concurrency target
-- (`UPDATE ... WHERE id = $slotId AND confirmed_count < headcount`, the same
-- conditional-updateMany shape ADR-057 names as the reused precedent) without
-- requiring its own schema-only migration before that logic lands.
CREATE TABLE "JobRequestSkillSlot" (
    "id" TEXT NOT NULL,
    "job_request_id" TEXT NOT NULL,
    "skill" "SkillTag" NOT NULL,
    "headcount" INTEGER NOT NULL,
    "confirmed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRequestSkillSlot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobRequestSkillSlot_job_request_id_idx" ON "JobRequestSkillSlot"("job_request_id");

CREATE INDEX "JobRequestSkillSlot_skill_idx" ON "JobRequestSkillSlot"("skill");

ALTER TABLE "JobRequestSkillSlot" ADD CONSTRAINT "JobRequestSkillSlot_job_request_id_fkey"
  FOREIGN KEY ("job_request_id") REFERENCES "WorkRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- confirmed_count must never exceed headcount, and neither may be negative --
-- same invariant-guard style as the existing JobRequest CHECK constraint
-- (migration.sql:563-566, workers_confirmed <= workers_needed).
ALTER TABLE "JobRequestSkillSlot" ADD CONSTRAINT "JobRequestSkillSlot_confirmed_count_check"
  CHECK ("confirmed_count" >= 0 AND "confirmed_count" <= "headcount");

ALTER TABLE "JobRequestSkillSlot" ADD CONSTRAINT "JobRequestSkillSlot_headcount_check"
  CHECK ("headcount" > 0);

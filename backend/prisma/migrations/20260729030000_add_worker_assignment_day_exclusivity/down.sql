-- Down migration for 20260729030000_add_worker_assignment_day_exclusivity
--
-- Deliberate asymmetry (documented explicitly per this plan's Definition of
-- Done §6 rollback-documentation requirement, and per
-- IMPLEMENTATION_EXECUTION_PLAN.md's PR 9.6 Rollback note):
--
--   * The re-keyed (worker_id, day) partial unique index IS reversed: dropped
--     and replaced with the original (work_request_id, worker_id) index over
--     the same active-status set, restoring PR 9.6's pre-migration
--     constraint shape exactly.
--   * The `day` column itself is LEFT IN PLACE, not dropped. It is an
--     additive column -- harmless to leave nullable-again-in-spirit-but-not-
--     in-fact (see below) even after the constraint that motivated it is
--     rolled back -- and dropping it would require its own backfill-reversal
--     reasoning for no safety benefit, since no other constraint or code
--     path in this rolled-back state depends on its absence. This is
--     cheaper and safer than a second down-migration removing it, matching
--     the plan's explicit instruction.
--
-- Note: this down.sql does NOT relax `day` back to nullable. Once this
-- migration has run forward, any code path still live in the deployed
-- application (e.g. placeOnCalendar()'s follow-up write, added in this same
-- PR) continues to populate `day` on every new row regardless of whether the
-- index rollback below has been applied -- there is no forward code path
-- that stops writing `day` as a side effect of this down-migration, so
-- leaving the NOT NULL constraint in place is safe and does not risk a
-- future insert violating it. If a rollback scenario ever requires
-- reverting the application code that writes `day` as well, that is a
-- separate, explicit follow-up (mirrors PR 9.5's own down.sql precedent of
-- documenting exactly what is and is not restorable).
BEGIN;

  DROP INDEX "WorkerAssignment_day_idx";

  DROP INDEX "WorkerAssignment_active_slot_unique";

  CREATE UNIQUE INDEX "WorkerAssignment_active_slot_unique"
    ON "WorkerAssignment"("work_request_id", "worker_id")
    WHERE "status" IN ('CONFIRMED', 'IN_PROGRESS');

  -- `day` column intentionally left in place -- see header.

COMMIT;

-- Surface worker-initiated cancellations (declared sick/vacation) as their own
-- count on the leaderboard aggregate.
--
-- Deliberately NOT folded into total_assignments: a self-declared absence is
-- not a failure to complete a shift, so it must not move completion_rate. It is
-- reported separately so a manager can see the pattern without it being
-- silently priced into the worker's rate.
--
-- Backfilled to 0; refreshWorkerOverallRating() recomputes the real value for a
-- worker on their next rating- or assignment-status change.
ALTER TABLE "WorkerOverallRating"
  ADD COLUMN "worker_cancellations" INTEGER NOT NULL DEFAULT 0;

-- GD-04 (quality rating single-writer fix): the DB trigger
-- Rating_refresh_overall_rating (20260613120000_v2_marketplace_init) and the
-- app-level upsert in quality/service.ts createRating() both write
-- WorkerOverallRating, but the trigger only recomputes average_score,
-- total_ratings, last_worked_at -- never total_assignments, completion_rate,
-- on_time_rate. On the INSERT path the app-level upsert (same transaction)
-- already supersedes the trigger's write. The trigger was the only mechanism
-- refreshing the aggregate on a WorkerAssignment status change (PATCH
-- /assignments/:id), and even then only for the three fields it covers --
-- total_assignments/completion_rate/on_time_rate were never trigger-covered
-- at all. quality/service.ts's refreshWorkerOverallRating() is now the single
-- writer; assignments/service.ts's AssignmentService.update() calls it
-- directly on any COMPLETED/CANCELLED transition so this path is not
-- silently dropped by removing the trigger.
DROP TRIGGER "Rating_refresh_overall_rating" ON "Rating";
DROP FUNCTION trg_rating_refresh_overall();
DROP FUNCTION refresh_worker_overall_rating(TEXT);

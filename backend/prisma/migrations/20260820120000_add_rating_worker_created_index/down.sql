-- Paired rollback (repo convention). Dropping a non-unique index is safe and
-- non-destructive: it removes only the access path, never data. Queries fall
-- back to the plan described in migration.sql.
DROP INDEX IF EXISTS "Rating_worker_id_created_at_idx";

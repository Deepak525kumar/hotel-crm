-- Down migration for 20260727020000_drop_rating_overall_trigger
-- Recreates the trigger/functions dropped by the forward migration, exactly as
-- originally defined in 20260613120000_v2_marketplace_init/migration.sql.
BEGIN;

  CREATE OR REPLACE FUNCTION refresh_worker_overall_rating(p_worker_id TEXT)
  RETURNS VOID AS $$
  DECLARE
    v_avg   FLOAT;
    v_count INTEGER;
    v_last  TIMESTAMP;
  BEGIN
    SELECT AVG("score")::FLOAT, COUNT(*)
      INTO v_avg, v_count
      FROM "Rating"
     WHERE "worker_id" = p_worker_id;

    SELECT MAX(wa."completed_at")
      INTO v_last
      FROM "WorkerAssignment" wa
     WHERE wa."worker_id" = p_worker_id
       AND wa."status" = 'COMPLETED';

    INSERT INTO "WorkerOverallRating" ("id", "worker_id", "average_score", "total_ratings", "last_worked_at", "updated_at")
    VALUES (gen_random_uuid()::TEXT, p_worker_id, COALESCE(v_avg, 0), COALESCE(v_count, 0), v_last, NOW())
    ON CONFLICT ("worker_id") DO UPDATE
      SET "average_score" = COALESCE(v_avg, 0),
          "total_ratings" = COALESCE(v_count, 0),
          "last_worked_at" = v_last,
          "updated_at"     = NOW();
  END;
  $$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION trg_rating_refresh_overall()
  RETURNS TRIGGER AS $$
  BEGIN
    IF (TG_OP = 'DELETE') THEN
      PERFORM refresh_worker_overall_rating(OLD."worker_id");
      RETURN OLD;
    ELSE
      PERFORM refresh_worker_overall_rating(NEW."worker_id");
      RETURN NEW;
    END IF;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER "Rating_refresh_overall_rating"
    AFTER INSERT OR UPDATE OR DELETE ON "Rating"
    FOR EACH ROW EXECUTE FUNCTION trg_rating_refresh_overall();

COMMIT;

-- Paired rollback (repo convention) for 20260901143341_add_room_log.
--
-- Drops the RoomLog table entirely. Its indexes and foreign keys go with it,
-- so they are not dropped separately. IF EXISTS makes this safe to run
-- against a partially-applied forward migration or an already-rolled-back
-- schema.
--
-- Data loss is inherent and accepted: RoomLog is the only home for
-- worker-logged rooms, so rolling back discards them. Nothing else depends
-- on it -- QualityVerification.room_number keeps its own free-text room
-- label, so inspections survive the rollback intact.
BEGIN;
  DROP TABLE IF EXISTS "RoomLog";
COMMIT;

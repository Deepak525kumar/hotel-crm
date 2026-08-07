-- Entity lifecycle parity for HotelGroup (2026-08-07).
--
-- HotelGroup previously had no soft-delete or deactivation columns at all --
-- deleteHotelGroup() issued a hard `DELETE`, detaching member hotels via
-- Hotel.hotel_group_id's ON DELETE SET NULL. Hotel meanwhile had both
-- is_active and deleted_at. The two entities now share one lifecycle:
-- ACTIVE -> DEACTIVATED (temporary, reversible) and -> DELETED (permanent
-- removal from operations, history preserved, admin-restorable).
--
-- Additive and nullable/defaulted, so every existing row is valid unchanged:
-- an existing group is ACTIVE (is_active = true) and not deleted
-- (deleted_at IS NULL), which is exactly its current meaning.

ALTER TABLE "HotelGroup" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HotelGroup" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "HotelGroup_is_active_idx" ON "HotelGroup"("is_active");
CREATE INDEX "HotelGroup_deleted_at_idx" ON "HotelGroup"("deleted_at");

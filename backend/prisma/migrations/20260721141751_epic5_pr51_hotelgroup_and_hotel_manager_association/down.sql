-- Down migration for 20260721141751_epic5_pr51_hotelgroup_and_hotel_manager_association
-- Reverses Epic 5 PR 5.1 (ADR-023 HotelGroup entity; ADR-025 Hotel.manager_user_id):
-- drops the two additive Hotel columns (their FK constraints/indexes go with
-- them via CASCADE) and the additive HotelGroup table. Safe only because this
-- migration is unread — no PR that consumes hotel_group_id/manager_user_id has
-- shipped (Execution Plan §8 rollback strategy for PR 5.1).
-- Idempotent (IF EXISTS) so a partially applied forward migration can still be
-- rolled back.
--
-- Paired-down convention: every forward migration ships a sibling `down.sql`.
-- See backend/scripts/migrate-harness.sh.

ALTER TABLE "Hotel" DROP COLUMN IF EXISTS "hotel_group_id";
ALTER TABLE "Hotel" DROP COLUMN IF EXISTS "manager_user_id";

DROP TABLE IF EXISTS "HotelGroup" CASCADE;

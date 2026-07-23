-- Down migration for 20260723210000_add_outbox_event
--
-- Additive-only up migration (new table + 5 new enum types, no existing
-- column/constraint touched) -- reversal is a straight drop. All rows in
-- OutboxEvent are lost; there is no prior state to restore them to, and no
-- other table references these types (no foreign keys, ADR-029).
BEGIN;

  DROP TABLE "OutboxEvent";

  DROP TYPE "OutboxTransport";
  DROP TYPE "OutboxStatus";
  DROP TYPE "OutboxSourceModule";
  DROP TYPE "OutboxAggregateType";
  DROP TYPE "OutboxEventType";

COMMIT;

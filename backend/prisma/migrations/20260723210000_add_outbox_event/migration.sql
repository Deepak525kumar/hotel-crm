-- ADR-029 (2026-07-23, GD-01: Transactional Outbox + Platform Worker). Adds the
-- OutboxEvent internal delivery/queue record, owned exclusively by
-- backend-notifications. Distinct from Notification (unchanged by this
-- migration — the user-facing inbox, existing REST API remains authoritative).
-- PR 7.1 scope only: model + transactional enqueue(). No Platform Worker, no
-- transports, no retry logic land in this migration — see
-- docs/implementation/IMPLEMENTATION_EXECUTION_PLAN.md Epic 7 (PR 7.2+).
-- Additive only: new enums + new table, no existing column/constraint touched.
-- Deliberately no foreign keys (ADR-029) — an internal ledger, not a relation
-- the domain model needs to join through; reversible via DROP TABLE + DROP TYPE.

-- CreateEnum
CREATE TYPE "OutboxEventType" AS ENUM ('NOTIFICATION_CREATED');

-- CreateEnum
CREATE TYPE "OutboxAggregateType" AS ENUM ('NOTIFICATION');

-- CreateEnum
CREATE TYPE "OutboxSourceModule" AS ENUM ('WORK_REQUESTS', 'WORK_APPLICATIONS', 'ATTENDANCE', 'QUALITY');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "OutboxTransport" AS ENUM ('EMAIL', 'PUSH', 'WEBHOOK', 'SMS');

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "event_type" "OutboxEventType" NOT NULL,
    "aggregate_type" "OutboxAggregateType" NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "source_module" "OutboxSourceModule" NOT NULL,
    "producer_service" TEXT NOT NULL,
    "transport" "OutboxTransport" NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "payload_version" INTEGER NOT NULL DEFAULT 1,
    "scheduled_for" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_event_id_key" ON "OutboxEvent"("event_id");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_next_attempt_at_idx" ON "OutboxEvent"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "OutboxEvent_correlation_id_idx" ON "OutboxEvent"("correlation_id");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregate_type_aggregate_id_idx" ON "OutboxEvent"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "OutboxEvent_created_at_idx" ON "OutboxEvent"("created_at");

-- PartialIndex (not expressible via `prisma migrate diff`, added by hand — mirrors
-- the RoomsCompletedEntry_rooms_completed_nonneg CHECK-constraint precedent in
-- 20260723000000_add_rooms_completed_entry/migration.sql). Targets the Platform
-- Worker's claim query (PR 7.2: WHERE status='PENDING' AND next_attempt_at <= now()),
-- keeping the index small as delivered/dead-lettered rows accumulate — only PENDING
-- rows are ever scanned by the claim, so only PENDING rows need to be indexed for it.
CREATE INDEX "OutboxEvent_pending_claim_idx" ON "OutboxEvent"("next_attempt_at") WHERE "status" = 'PENDING';

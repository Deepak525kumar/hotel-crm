-- SPEC-GEO-001 @0.1.2 FROZEN, GD-14 Decided 2026-07-27.
-- state-worker-geo-checkin: backend-geo-owned (OD-GEO-002), additive,
-- pre-launch, no production data to migrate.
-- RULE-GEO-003/OD-GEO-005: raw latitude/longitude are stored but MUST NEVER
-- be returned by any admin/manager-facing API -- enforced in service.ts's
-- DTO mapping, not by this schema.
-- TREQ-GEO-004/005 (Tier 1, CRR §25): 6-month hard-delete retention sweep
-- scans on checked_at -- indexed here for that sweep's query.

CREATE TABLE "WorkerGeoCheckin" (
  "id"              TEXT NOT NULL,
  "worker_id"       TEXT NOT NULL,
  "hotel_id"        TEXT NOT NULL,
  "latitude"        DOUBLE PRECISION NOT NULL,
  "longitude"       DOUBLE PRECISION NOT NULL,
  "distance_meters" DOUBLE PRECISION NOT NULL,
  "inside_radius"   BOOLEAN NOT NULL,
  "checked_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkerGeoCheckin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerGeoCheckin_worker_id_idx" ON "WorkerGeoCheckin"("worker_id");
CREATE INDEX "WorkerGeoCheckin_hotel_id_idx" ON "WorkerGeoCheckin"("hotel_id");
CREATE INDEX "WorkerGeoCheckin_checked_at_idx" ON "WorkerGeoCheckin"("checked_at");

ALTER TABLE "WorkerGeoCheckin" ADD CONSTRAINT "WorkerGeoCheckin_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkerGeoCheckin" ADD CONSTRAINT "WorkerGeoCheckin_hotel_id_fkey"
  FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

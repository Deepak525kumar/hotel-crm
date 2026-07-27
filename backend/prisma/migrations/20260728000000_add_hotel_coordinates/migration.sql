-- GD-14/OD-GEO-001 (SPEC-GEO-001 FROZEN @0.1.2): hotel-coordinate source of
-- truth, as columns on Hotel (state-hotel, backend-crm-owned) -- not a new
-- backend-geo-owned domain. Nullable: most hotels have none set yet;
-- backend-geo's distance-check fails closed (OD-GEO-003) when either is null.
ALTER TABLE "Hotel" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Hotel" ADD COLUMN "longitude" DOUBLE PRECISION;

-- SPEC-CONSENT-001@0.2.0 FROZEN (ADR-015 bounded context; ADR-037/GD-17
-- lifecycle & fail-safety resolutions). Additive, pre-launch, no production
-- data to migrate (PDD §10 Phase 3).
--
-- RULE-CONSENT-09: no other module may persist a competing consent-state
-- model; backend-consent is the exclusive owner of consent lifecycle,
-- records, versions, withdrawal, renewal, and audit history.

CREATE TYPE "ConsentDecision" AS ENUM ('GRANTED', 'DECLINED', 'WITHDRAWN', 'RENEWED');

CREATE TABLE "ConsentRecord" (
  "id"               TEXT NOT NULL,
  "worker_id"        TEXT NOT NULL,
  "consent_instance" TEXT NOT NULL,
  "notice_version"   TEXT NOT NULL,
  "decision"         "ConsentDecision" NOT NULL,
  "decided_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsentRecord_worker_id_consent_instance_idx" ON "ConsentRecord"("worker_id", "consent_instance");
CREATE INDEX "ConsentRecord_decided_at_idx" ON "ConsentRecord"("decided_at");

ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

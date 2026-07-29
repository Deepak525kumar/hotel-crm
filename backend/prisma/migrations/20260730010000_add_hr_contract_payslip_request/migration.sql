-- SPEC-HR-001 (ADR-012/ADR-014 bounded context), PR 1 of the HR implementation
-- plan following the backend-hr/SPEC-EMP-001 boundary review.
-- Additive, pre-launch, no production data to migrate.
-- ADR-039 (2026-07-28): Contract carries no salary/compensation field;
--   PayslipRequest carries no gross-salary/wage-computation field of any kind
--   (backend-hr never computes payroll — request-tracking only).

CREATE TYPE "ContractStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXTENDED', 'PERMANENT');

CREATE TYPE "PayslipRequestStatus" AS ENUM ('REQUESTED', 'FULFILLED');

CREATE TABLE "Contract" (
  "id"                   TEXT NOT NULL,
  "worker_id"            TEXT NOT NULL,
  "template_id"          TEXT NOT NULL,
  "position"             TEXT NOT NULL,
  "start_date"           DATE NOT NULL,
  "end_date"             DATE,
  "status"               "ContractStatus" NOT NULL DEFAULT 'PENDING',
  "generated_pdf_key"    TEXT,
  "scanned_document_id"  TEXT,
  "confirmed_by_id"      TEXT,
  "confirmed_at"         TIMESTAMP(3),
  "expires_at"           TIMESTAMP(3),
  "reminder_1yr_sent_at" TIMESTAMP(3),
  "reminder_2yr_sent_at" TIMESTAMP(3),
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contract_scanned_document_id_key" ON "Contract"("scanned_document_id");

CREATE INDEX "Contract_worker_id_idx" ON "Contract"("worker_id");
CREATE INDEX "Contract_status_idx" ON "Contract"("status");
CREATE INDEX "Contract_expires_at_idx" ON "Contract"("expires_at");

ALTER TABLE "Contract" ADD CONSTRAINT "Contract_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- scanned_document_id -> WorkerDocument: SetNull, not Cascade. If the
-- underlying document row is ever removed, the Contract row (and its
-- confirmation/status history) is preserved — only the scan reference clears.
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_scanned_document_id_fkey"
  FOREIGN KEY ("scanned_document_id") REFERENCES "WorkerDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- confirmed_by_id -> User: SetNull, not Cascade/Restrict. Deleting the
-- confirming manager's account must not delete or block deletion of the
-- Contract row; the confirmation event's audit trail lives in AuditLog
-- (RULE-HR-15), not solely on this FK.
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_confirmed_by_id_fkey"
  FOREIGN KEY ("confirmed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PayslipRequest" (
  "id"              TEXT NOT NULL,
  "worker_id"       TEXT NOT NULL,
  "period_start"    DATE NOT NULL,
  "period_end"      DATE NOT NULL,
  "status"          "PayslipRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "fulfilled_by_id" TEXT,
  "fulfilled_at"    TIMESTAMP(3),
  "escalated_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PayslipRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayslipRequest_worker_id_idx" ON "PayslipRequest"("worker_id");
CREATE INDEX "PayslipRequest_status_idx" ON "PayslipRequest"("status");

ALTER TABLE "PayslipRequest" ADD CONSTRAINT "PayslipRequest_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayslipRequest" ADD CONSTRAINT "PayslipRequest_fulfilled_by_id_fkey"
  FOREIGN KEY ("fulfilled_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

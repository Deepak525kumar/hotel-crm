-- SPEC-DOCUMENTS-001 @0.1.4 FROZEN, GD-16 Decided 2026-07-27.
-- state-worker-document: additive, pre-launch, no production data to migrate.
-- RULE-DOC-09/OD-DOC-017: storage keys are server-generated with a UUIDv4 segment
--   (enforced in DocumentService.generateStorageKey); this migration only defines
--   the schema constraint (UNIQUE on s3_key), not the generation logic.
-- OD-DOC-019/FIND-PERF-001: compound index on (worker_id, category) created
--   at schema-creation time, not as a follow-on migration.

CREATE TYPE "DocumentCategory" AS ENUM ('GENERAL', 'WORK_PERMIT');

CREATE TABLE "WorkerDocument" (
  "id"                TEXT NOT NULL,
  "worker_id"         TEXT NOT NULL,
  "uploaded_by_id"    TEXT NOT NULL,
  "category"          "DocumentCategory" NOT NULL,
  -- s3_key: server-generated, includes a UUIDv4 segment (RULE-DOC-09).
  -- UNIQUE ensures no two records reference the same S3 object.
  "s3_key"            TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "mime_type"         TEXT NOT NULL,
  "file_size_bytes"   INTEGER NOT NULL,
  -- REQ-DOC-001: expiry tracking. NULL = no expiry set. Consequence on crossing
  -- is OD-DOC-003 (open; not implemented here).
  "expires_at"        DATE,
  -- REQ-DOC-003: true only for non-EU/EEA/Swiss workers' work-permit documents.
  "is_work_permit"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkerDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkerDocument_s3_key_key" ON "WorkerDocument"("s3_key");

-- OD-DOC-019: compound index on (worker_id, category) — required at
-- schema-creation time (spec note, FIND-PERF-001).
CREATE INDEX "WorkerDocument_worker_id_category_idx" ON "WorkerDocument"("worker_id", "category");
CREATE INDEX "WorkerDocument_worker_id_idx" ON "WorkerDocument"("worker_id");

ALTER TABLE "WorkerDocument" ADD CONSTRAINT "WorkerDocument_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- uploaded_by_id is NOT CASCADE-deleted: if the uploader's account is deleted,
-- the document record is preserved (belongs to the worker). The uploader FK
-- records audit provenance; a RESTRICT would block admin account deletions.
-- NO ACTION matches the platform's soft-delete pattern (User.deleted_at).
ALTER TABLE "WorkerDocument" ADD CONSTRAINT "WorkerDocument_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

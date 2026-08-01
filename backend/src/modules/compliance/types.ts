import type { WorkerDocumentDto } from '../documents/types.js';
import type { ConsentRecordDto } from '../consent/types.js';
import type { AuditLogEntryDto } from '../auth/types.js';

// SPEC-COMPLIANCE-001@0.1.0 REVIEW (NOT FROZEN). PR 3 of 4:
// IF-COMPLIANCE-FulfilSubjectRightsRequest (REQ-COMPLIANCE-011,
// RULE-COMPLIANCE-02). Self-scoped to the requesting worker only -- the
// spec names no Admin/DPO-on-behalf-of-worker caller class for this
// interface (unlike the deferred IF-COMPLIANCE-GetGovernanceReport, whose
// undefined "Admin/DPO-equivalent" caller class, OD-COMPLIANCE-006, is NOT
// resolved or approximated here).
//
// Each field is exactly the source module's own DTO, re-exported unchanged
// -- Compliance never reshapes or duplicates another module's owned data
// (RULE-COMPLIANCE-03). Retention is deliberately absent: it has no
// worker-scoped export interface (IF-RETENTION-GetDeletionAuditLog/
// CheckEligibility are category/tier-metadata queries, not a per-worker
// data export), so it is not one of this bundle's sources -- consistent
// with the spec's own Dependencies table only naming backend-documents,
// backend-consent, and backend-auth as this interface's actual sources.
export interface SubjectRightsSourceResult<T> {
  status: 'ok' | 'unavailable';
  data: T | null;
}

// OD-COMPLIANCE-005 (partial-failure/retry/idempotency behavior, unresolved
// by CRR/PDD): disclosed default for this PR -- one source module failing
// does not fail the whole request; the bundle reports each source's own
// status alongside whatever data succeeded, rather than either discarding
// the entire response or silently omitting the failed source. Not a
// resolution of OD-COMPLIANCE-005 (a human/architecture decision could
// still choose all-or-nothing later); a disclosed implementation-time
// choice, mirroring how every prior epic (Retention's OD-RETENTION-03,
// Consent's stale-notice rejection) picked and disclosed a default rather
// than blocking on an open decision that doesn't gate implementation.
export interface SubjectRightsBundle {
  worker_id: string;
  generated_at: string;
  documents: SubjectRightsSourceResult<WorkerDocumentDto[]>;
  consent_history: SubjectRightsSourceResult<{ data: ConsentRecordDto[]; total: number }>;
  audit_trail: SubjectRightsSourceResult<{ data: AuditLogEntryDto[]; total: number }>;
}

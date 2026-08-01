import { BaseService } from '../../lib/base-service.js';
import { authService } from '../auth/service.js';
import { consentService } from '../consent/service.js';
import { documentService } from '../documents/service.js';
import type { AuditLogQuery, AuditLogEntryDto } from '../auth/types.js';
import type { SubjectRightsBundle, SubjectRightsSourceResult } from './types.js';

// SPEC-COMPLIANCE-001@0.1.0 REVIEW (NOT FROZEN). PR 2/3 of 4:
// IF-COMPLIANCE-GetAuditTrail (REQ-COMPLIANCE-010, RULE-COMPLIANCE-01) and
// IF-COMPLIANCE-FulfilSubjectRightsRequest (REQ-COMPLIANCE-011,
// RULE-COMPLIANCE-02).
//
// Pure orchestration -- this module owns no Prisma model of its own
// (Ownership and Boundaries: "Owned state: None confirmed today"). It DOES
// extend BaseService as of PR 3, but only to reach the shared
// BaseService.logAudit() helper -- the same platform-wide write path every
// other module (attendance/quality/crm/users/auth/work-requests/etc.)
// already uses to write AuditLog rows (ADR-016: "Existing writer call
// sites across all modules continue writing through the shared
// BaseService.logAudit helper"). This does not create a Compliance-owned
// table or make Compliance AuditLog's authoritative writer in the ADR-016
// governance sense -- it makes Compliance one more of the many existing
// shared-helper writers, same as every sibling module. No code path here
// ever calls prisma.auditLog.findMany/count directly (that stays
// exclusively behind authService.getAuditTrail()) or reads/writes any
// other model directly.
//
// Every cross-module read (authService/consentService/documentService) is
// a direct in-process call, mirroring backend-hr/service.ts's existing
// documentService import (ADR-032: direct in-process calls are the
// platform standard for synchronous cross-module effects; no HTTP hop, no
// event bus).
export class ComplianceService extends BaseService {
  // RULE-COMPLIANCE-01: reads AuditLog only through backend-auth's
  // published interface -- no code path in this module ever imports
  // PrismaClient or calls prisma.auditLog.*. AuditLogQuery/AuditLogEntryDto
  // are re-exported as-is, not reshaped into a Compliance-specific type --
  // backend-auth owns that interface's shape (see auth/types.ts's own
  // ADR-016 comment); this method adds no Compliance-specific field,
  // filter, or semantic on top of it. No route/controller for this method
  // -- no external (frontend/mobile) caller was identified for it; only
  // this module's own subject-rights orchestration below calls it.
  async getAuditTrail(
    query: AuditLogQuery
  ): Promise<{ data: AuditLogEntryDto[]; total: number }> {
    return authService.getAuditTrail(query);
  }

  // ---------------------------------------------------------------------------
  // IF-COMPLIANCE-FulfilSubjectRightsRequest (REQ-COMPLIANCE-011/RULE-COMPLIANCE-02)
  // ---------------------------------------------------------------------------
  // Self-scoped to the requesting worker only -- the spec names no Admin/
  // DPO-on-behalf-of-worker caller class for this interface (unlike the
  // deferred IF-COMPLIANCE-GetGovernanceReport, whose undefined
  // "Admin/DPO-equivalent" class, OD-COMPLIANCE-006, is NOT resolved or
  // approximated here -- that interface remains entirely unbuilt).
  //
  // RULE-COMPLIANCE-03: no source module's data is duplicated into a
  // Compliance-owned copy -- this method composes a point-in-time response
  // from each source's own already-existing DTO shape and returns it
  // directly, storing nothing.
  //
  // OD-COMPLIANCE-005 (partial-failure behavior, unresolved by CRR/PDD):
  // disclosed default -- one source module failing does not fail the whole
  // request; each source's own ok/unavailable status is reported alongside
  // whatever data succeeded (SubjectRightsSourceResult, types.ts). Not a
  // resolution of OD-COMPLIANCE-005, a disclosed implementation-time
  // choice, same pattern every prior epic used for its own open decisions.
  //
  // Retention deliberately excluded from the fan-out -- see types.ts's own
  // comment: it has no worker-scoped export interface.
  async fulfilSubjectRightsRequest(workerId: string): Promise<SubjectRightsBundle> {
    const [documents, consentHistory, auditTrail] = await Promise.all([
      documentService
        .exportWorkerDocuments(workerId, workerId, 'worker')
        .then((data): SubjectRightsSourceResult<typeof data> => ({ status: 'ok', data }))
        .catch((): SubjectRightsSourceResult<never> => ({ status: 'unavailable', data: null })),
      consentService
        .getAuditHistory({ worker_id: workerId, page: 1, per_page: 100 }, { userId: workerId, role: 'worker' })
        .then((data): SubjectRightsSourceResult<typeof data> => ({ status: 'ok', data }))
        .catch((): SubjectRightsSourceResult<never> => ({ status: 'unavailable', data: null })),
      authService
        .getAuditTrail({ actor_id: workerId, page: 1, per_page: 100 })
        .then((data): SubjectRightsSourceResult<typeof data> => ({ status: 'ok', data }))
        .catch((): SubjectRightsSourceResult<never> => ({ status: 'unavailable', data: null })),
    ]);

    // OD-COMPLIANCE-008 (self-referential audit-completeness gap, disclosed
    // default): Compliance's own subject-rights fulfilment is itself
    // audited, writing through the same shared BaseService.logAudit helper
    // every other module uses -- closing the gap the spec's own Security
    // section names ("would Compliance's own governance activity be
    // audited by the very AuditLog it reads?") rather than leaving it
    // silently unaddressed now that a real action exists to audit.
    await this.logAudit(workerId, 'worker', 'EXPORT', 'SUBJECT_RIGHTS_REQUEST', workerId, {
      documents_status: documents.status,
      consent_history_status: consentHistory.status,
      audit_trail_status: auditTrail.status,
    });

    return {
      worker_id: workerId,
      generated_at: new Date().toISOString(),
      documents,
      consent_history: consentHistory,
      audit_trail: auditTrail,
    };
  }
}

export const complianceService = new ComplianceService();

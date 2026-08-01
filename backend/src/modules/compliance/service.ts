import { authService } from '../auth/service.js';
import type { AuditLogQuery, AuditLogEntryDto } from '../auth/types.js';

// SPEC-COMPLIANCE-001@0.1.0 REVIEW (NOT FROZEN). PR 2 of 4:
// IF-COMPLIANCE-GetAuditTrail (REQ-COMPLIANCE-010, RULE-COMPLIANCE-01).
//
// Pure orchestration -- this module owns no Prisma model (Ownership and
// Boundaries: "Owned state: None confirmed today"). getAuditTrail() is a
// direct in-process call into authService, the same pattern
// backend-hr/service.ts already uses to call documentService (ADR-032:
// direct in-process calls are the platform standard for synchronous
// cross-module effects; no HTTP hop, no event bus). No route/controller
// exists for this method in this PR -- no external (frontend/mobile)
// caller was identified for it; only backend-compliance's own future
// orchestration (PR 3's subject-rights bundle, or an eventual
// IF-COMPLIANCE-GetGovernanceReport, OD-COMPLIANCE-002/003/006, explicitly
// deferred and NOT built here) would call it.
//
// RULE-COMPLIANCE-01: reads AuditLog only through backend-auth's published
// interface -- no code path in this module ever imports PrismaClient or
// calls prisma.auditLog.*. AuditLogQuery/AuditLogEntryDto are re-exported
// as-is, not reshaped into a Compliance-specific type -- backend-auth owns
// that interface's shape (see types.ts's own ADR-016 comment); this method
// adds no Compliance-specific field, filter, or semantic on top of it.
export class ComplianceService {
  async getAuditTrail(
    query: AuditLogQuery
  ): Promise<{ data: AuditLogEntryDto[]; total: number }> {
    return authService.getAuditTrail(query);
  }
}

export const complianceService = new ComplianceService();

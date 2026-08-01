// SPEC-COMPLIANCE-001@0.1.0 REVIEW (NOT FROZEN), PR 3 of 4. Only
// GetDeletionAuditLog-equivalent read (IF-COMPLIANCE-FulfilSubjectRightsRequest)
// is routed; IF-COMPLIANCE-GetAuditTrail remains in-process-only (see
// controller.ts's header comment).

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { complianceController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// IF-COMPLIANCE-FulfilSubjectRightsRequest: any authenticated role, self-
// scoped to the caller's own worker_id (req.auth.userId) -- no Admin-on-
// behalf-of-worker caller class is named in this interface's own spec row.
//
// WARNING for IF-COMPLIANCE-GetGovernanceReport's future implementation
// (deferred, OD-COMPLIANCE-002/003/006 unresolved -- not built anywhere in
// this module today): do NOT add that endpoint to complianceController or
// this route file by extending/reusing fulfilSubjectRightsRequest's
// self-scope-only authorization. GetGovernanceReport's own spec row names
// an "Admin/DPO-equivalent" caller class with NO defined RBAC scope
// (OD-COMPLIANCE-006) -- reusing this self-scoped route/controller would
// silently grant that undefined access rather than leaving it correctly
// unbuilt. Give it its own controller method and its own route once
// OD-COMPLIANCE-006 is actually resolved by a human/architecture decision.
router.post('/subject-rights-export', (req, res, next) =>
  complianceController.fulfilSubjectRightsRequest(req, res, next)
);

export default router;

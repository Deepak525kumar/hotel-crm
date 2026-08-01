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
router.post('/subject-rights-export', (req, res, next) =>
  complianceController.fulfilSubjectRightsRequest(req, res, next)
);

export default router;

// SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN), PR 5 of 5. Only
// GetDeletionAuditLog/CheckEligibility are routed; RegisterCategory/
// TagRecord remain in-process-only (see controller.ts's header comment).

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { retentionController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// IF-RETENTION-GetDeletionAuditLog: any authenticated role -- OD-RETENTION-05
// (Admin RBAC scope) is explicitly OPEN, so no role gate beyond
// authentication is added; see controller.ts's header comment.
router.get('/audit-log', (req, res, next) => retentionController.getDeletionAuditLog(req, res, next));

// IF-RETENTION-CheckEligibility: any authenticated role -- no Admin caller
// class is named in this interface's own spec row.
router.get('/eligibility', (req, res, next) => retentionController.checkEligibility(req, res, next));

export default router;

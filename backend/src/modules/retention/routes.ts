// SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN), PR 5 of 5. Only
// GetDeletionAuditLog/CheckEligibility are routed; RegisterCategory/
// TagRecord remain in-process-only (see controller.ts's header comment).

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import { retentionController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// IF-RETENTION-GetDeletionAuditLog: Restricting to admin-only per project owner
// direction overriding OD-RETENTION-05's explicitly OPEN state.
router.get('/audit-log', requireRole('admin'), (req, res, next) => retentionController.getDeletionAuditLog(req, res, next));

// IF-RETENTION-CheckEligibility: any authenticated role -- no Admin caller
// class is named in this interface's own spec row.
router.get('/eligibility', (req, res, next) => retentionController.checkEligibility(req, res, next));

export default router;

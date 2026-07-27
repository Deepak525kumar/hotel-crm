// SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16 Decided 2026-07-27).
// GD-16: self-upload (worker) + manager-upload only; hotel-scoped read.

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { checkWorkerScope, requireRole } from '../../middleware/permissions.js';
import { documentController } from './controller.js';

// checkWorkerScope() (permissions.ts resolveWorkerScope) allows only
// admin (bypass) and manager (group-scope check) — every other role,
// including worker, is unconditionally denied. It was built for
// backend-hr's admin/manager-only contract-scan routes and cannot express
// GD-16's worker-self-service requirement. Applying it in front of a
// worker's own request would deny GD-16's mandated actor, so it is only
// applied for the admin/manager path; worker self-access is instead
// self-scoped in the service layer (DocumentService checks actor_id ===
// worker_id for the 'worker' role), the same split already used by
// calendar's /my-absences and employee-management's own-profile read.
function scopeWorkerRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.role === 'worker') {
      next();
      return;
    }
    checkWorkerScope()(req, res, next);
  };
}

const router = Router();
router.use(authMiddleware);

router.post(
  '/workers/:worker_id/documents',
  requireRole(['admin', 'manager', 'worker']),
  scopeWorkerRoute(),
  (req, res, next) => documentController.uploadDocument(req, res, next)
);

router.get(
  '/workers/:worker_id/documents',
  requireRole(['admin', 'manager', 'worker']),
  scopeWorkerRoute(),
  (req, res, next) => documentController.listWorkerDocuments(req, res, next)
);

router.get(
  '/workers/:worker_id/documents/completeness',
  requireRole(['admin', 'manager', 'worker']),
  scopeWorkerRoute(),
  (req, res, next) => documentController.getDocumentCompleteness(req, res, next)
);

router.get(
  '/workers/:worker_id/documents/export',
  requireRole(['admin', 'manager', 'worker']),
  scopeWorkerRoute(),
  (req, res, next) => documentController.exportWorkerDocuments(req, res, next)
);

// FIND-SEC-DOC-01: bare document id — ownership binding enforced in
// DocumentService.getDocument, not by a worker_id-keyed scope middleware.
router.get(
  '/documents/:document_id',
  requireRole(['admin', 'manager', 'worker']),
  (req, res, next) => documentController.getDocument(req, res, next)
);

export default router;

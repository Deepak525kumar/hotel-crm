import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { checkWorkerScope, requirePermission, requireRole } from '../../middleware/permissions.js';
import { hrController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// ADR-030 PR-1 (C-10 / OD-HR-13 / FIND-SEC-HR-04): these routes previously
// gated on requirePermission('hr:read'/'hr:write') alone — no role gate, no
// hotel/group-scope enforcement. The write routes below carry a worker_id
// (body or path) and are now scoped via checkWorkerScope() (group-grain,
// mirroring how the employment record itself is scoped). The two list routes
// below carry no worker_id/hotel_id and no query-filter schema exists to
// scope-filter against, so — per product decision — they stay Admin-only
// rather than exposing a manager-visible, unscoped read; scoping them for
// MANAGER is deferred to when the HR module has a real data model and query
// contract to filter against.

// Contracts
router.get('/contracts', requireRole('admin'), requirePermission('hr:read'), (req, res, next) =>
  hrController.listContracts(req, res, next)
);
router.post(
  '/contracts',
  requireRole(['admin', 'manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.createContract(req, res, next)
);

// Payroll
router.get('/payroll', requireRole('admin'), requirePermission('hr:read'), (req, res, next) =>
  hrController.listPayroll(req, res, next)
);
router.post(
  '/payroll',
  requireRole(['admin', 'manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.createPayroll(req, res, next)
);

// Documents
router.post(
  '/workers/:worker_id/documents',
  requireRole(['admin', 'manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.uploadDocument(req, res, next)
);

export default router;

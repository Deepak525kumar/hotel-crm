import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middleware/auth.js';
import { checkWorkerScope, requirePermission, requireRole } from '../../middleware/permissions.js';
import { hrController } from './controller.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '../documents/upload-policy.js';
import { ValidationError } from '../../lib/errors.js';

// MIG-GAP-DOC-001 / RULE-HR-13 / RULE-DOC-09: the contract-scan upload is
// "mechanically treated like any other document upload" (CRR §9) — reuses
// Documents' declared upload policy (upload-policy.ts), not another route's
// implementation file, and not a HR-specific policy of its own. Memory
// storage only, same as documents/routes.ts.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
      return;
    }
    cb(null, true);
  },
});

// checkWorkerScope() allows only admin (bypass) and manager (group-scope
// check) — every other role, including worker, is unconditionally denied.
// IF-HR-GetContractStatus (ADR-042/OD-HR-10) requires worker self-access,
// which checkWorkerScope() cannot express. Worker self-access is instead
// self-scoped in the service layer (HrService.getContractStatus checks
// actorId === workerId for the 'worker' role) — the identical
// requireRole(['admin','manager','worker']) + scopeWorkerRoute() shape (no
// requirePermission() call at all) already established by every one of
// documents/routes.ts's four admin/manager/worker routes for this exact
// actor set. requirePermission()'s array form is an AND check (every() in
// permissions.ts), not OR, so it cannot express "hr:read OR
// hr:contract:read-own" across roles that hold different tokens for the
// same route — matching Documents' own precedent of using no token gate at
// all here, not inventing a parser-invisible inline check.
function scopeWorkerRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.role === 'worker') {
      next();
      return;
    }
    checkWorkerScope()(req, res, next);
  };
}

// Translates multer's own MulterError into the platform's ValidationError
// shape (422), mirroring documents/routes.ts's handleUploadErrors().
function handleUploadErrors() {
  return (err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File exceeds the maximum size of ${MAX_FILE_SIZE_BYTES} bytes`
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Unsupported file type or unexpected field'
            : err.message;
      next(new ValidationError(message));
      return;
    }
    next(err);
  };
}

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

// IF-HR-GetContractStatus (ADR-042/OD-HR-10, FIND-SEC-HR-03 IDOR guard):
// admin (unconditional), manager (checkWorkerScope, group-grain), and
// worker (self-scoped inside HrService.getContractStatus — worker_id is
// never trusted from the path for a worker-role caller beyond that
// self-check). scopeWorkerRoute() lets a worker through to the service's
// own check rather than being denied by checkWorkerScope().
router.get(
  '/workers/:worker_id/contract-status',
  requireRole(['admin', 'manager', 'worker']),
  scopeWorkerRoute(),
  (req, res, next) => hrController.getContractStatus(req, res, next)
);

// Documents (contract-scan mechanism-class upload, MIG-GAP-DOC-001 — delegates
// to backend-documents' DocumentService rather than hosting the mechanism)
router.post(
  '/workers/:worker_id/documents',
  requireRole(['admin', 'manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  upload.single('file'),
  handleUploadErrors(),
  (req: Request, res: Response, next: NextFunction) => hrController.uploadDocument(req, res, next)
);

export default router;

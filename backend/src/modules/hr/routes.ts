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
// requireRole(['admin','manager','worker']) + scopeWorkerRoute() shape
// documents/routes.ts's four admin/manager/worker routes already establish.
function scopeWorkerRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.role === 'worker') {
      next();
      return;
    }
    checkWorkerScope()(req, res, next);
  };
}

// ADR-042/OD-HR-10: worker access to IF-HR-GetContractStatus MUST be gated
// by the dedicated hr:contract:read-own token, "satisfied by construction,"
// not left to service-layer self-scoping alone. requirePermission()'s array
// form is an AND check (every() in permissions.ts), so a single
// requirePermission(['hr:read', 'hr:contract:read-own']) call cannot express
// "hr:read OR hr:contract:read-own" across roles that hold different
// tokens for the same route -- documents/routes.ts's identical
// admin/manager/worker shape has no dedicated worker token to enforce at
// all (GD-16 never introduced one), so it is not a valid precedent for
// omitting the check here. This performs the role-specific OR the AND
// primitive cannot: admin/manager must hold hr:read; worker must hold
// hr:contract:read-own.
//
// @requiresPermission hr:read hr:contract:read-own
// (see __tests__/support/route-registry.ts's own header comment: this
// annotation is how the static D-8 permission-token-hygiene parser
// discovers tokens checked inside a role-conditional wrapper function
// rather than a literal requirePermission('...') call site.)
function requireContractReadAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requiredToken = req.auth?.role === 'worker' ? 'hr:contract:read-own' : 'hr:read';
    requirePermission(requiredToken)(req, res, next);
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

// ADR-030 PR-1 (C-10 / OD-HR-13 / FIND-SEC-HR-04): write routes carry a
// worker_id (body or path) and are scoped via checkWorkerScope()
// (group-grain, mirroring how the employment record itself is scoped).
// ADR-043 (2026-07-28): the two list routes below extend to MANAGER, scoped
// server-side to the caller's own hotel_group_id inside
// hrController.listContracts()/listPayroll() themselves (checkWorkerScope()
// cannot gate a list route with no single worker_id param) — the identical
// resolveNonAdminScopeFilter() mechanism ADR-030 PR-4 already established
// for users/service.ts's listUsers(), not a new authorization pattern.

// Contracts
router.get('/contracts', requireRole(['admin', 'manager']), requirePermission('hr:read'), (req, res, next) =>
  hrController.listContracts(req, res, next)
);
router.post(
  '/contracts',
  requireRole(['admin', 'manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.createContract(req, res, next)
);

// Payroll (lists/creates PayslipRequest records — ADR-039, no payroll computation)
router.get('/payroll', requireRole(['admin', 'manager']), requirePermission('hr:read'), (req, res, next) =>
  hrController.listPayroll(req, res, next)
);
router.post(
  '/payroll',
  requireRole(['admin', 'manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.createPayroll(req, res, next)
);

// IF-HR-FulfilPayslipRequest (RULE-HR-09): Manager/Admin marks a request
// emailed. Keyed on the request's own id, not a worker_id path param — no
// checkWorkerScope() call; the request row itself carries no hotel/group
// field to scope against (same shape as IF-HR-ConfirmContractSigned's
// worker-scoped precondition check happening inside the service, not a
// route-level middleware, when no clean route-level scope key exists).
router.post(
  '/payroll/:request_id/fulfil',
  requireRole(['admin', 'manager']),
  requirePermission('hr:write'),
  (req, res, next) => hrController.fulfilPayslipRequest(req, res, next)
);

// IF-HR-RequestPayslip (ADR-042: hr:payslip:request, self-scoped — worker_id
// is ALWAYS req.auth.userId, never a client-supplied field). Admin/Manager
// use POST /payroll above to create a request on a worker's behalf instead.
router.post(
  '/payslip-requests',
  requireRole('worker'),
  requirePermission('hr:payslip:request'),
  (req, res, next) => hrController.requestPayslip(req, res, next)
);

// IF-HR-GetContractStatus (ADR-042/OD-HR-10, FIND-SEC-HR-03 IDOR guard):
// admin/manager must hold hr:read; worker must hold hr:contract:read-own
// (requireContractReadAccess() enforces this role-specific split). Manager
// is additionally scoped via checkWorkerScope() (group-grain); worker is
// self-scoped inside HrService.getContractStatus — worker_id is never
// trusted from the path for a worker-role caller beyond that self-check.
// scopeWorkerRoute() lets a worker through to the service's own check
// rather than being denied by checkWorkerScope().
router.get(
  '/workers/:worker_id/contract-status',
  requireRole(['admin', 'manager', 'worker']),
  requireContractReadAccess(),
  scopeWorkerRoute(),
  (req, res, next) => hrController.getContractStatus(req, res, next)
);

// IF-HR-UploadSignedContract (RULE-HR-13/OD-HR-13): Manager/Admin only, per
// spec's own actor list; hotel-scope enforcement via checkWorkerScope(),
// same as every other HR write route.
router.post(
  '/workers/:worker_id/contract-scan',
  requireRole(['admin', 'manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  upload.single('file'),
  handleUploadErrors(),
  (req: Request, res: Response, next: NextFunction) => hrController.uploadSignedContract(req, res, next)
);

// IF-HR-ConfirmContractSigned (RULE-HR-03/13, OD-HR-13): Manager/Admin only.
router.post(
  '/workers/:worker_id/contract-confirm',
  requireRole(['admin', 'manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.confirmContractSigned(req, res, next)
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

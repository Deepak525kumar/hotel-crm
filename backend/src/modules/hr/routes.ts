import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middleware/auth.js';
import { checkWorkerScope, requirePermission, requireRole } from '../../middleware/permissions.js';
import { hrController } from './controller.js';
import { validateQuery } from '../../middleware/validation.js';
import { ListContractsQuerySchema, ListPayslipRequestsQuerySchema } from './types.js';
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
// `regional_manager` appears in every role gate in this module per ADR-030 §3
// C-29 (Manage HR contracts / payroll) and C-30 (View HR records), both of which
// grant RM `✓ᶜ` with the `hr:write`/`hr:read` tokens RM already holds
// (config/constants.ts). It was previously absent from all of them, so an RM
// was denied the entire HR surface despite holding the ratified tokens.
//
// Two layers had to change together: these role lists, AND
// middleware/permissions.ts's resolveWorkerScope(), which had no RM branch and
// so denied every checkWorkerScope()-guarded route below even once the role gate
// passed. The role-conditional wrappers (requireContractReadAccess,
// requirePayslipReadAccess) needed no change — they branch on
// `role === 'worker'`, so an RM resolves to `hr:read`, which it holds.
//
// IF-HR-GetContractStatus (ADR-042/OD-HR-10) requires worker self-access,
// which checkWorkerScope() cannot express. Worker self-access is instead
// self-scoped in the service layer (HrService.getContractStatus checks
// actorId === workerId for the 'worker' role) — the identical
// requireRole(['admin','manager','regional_manager','worker']) +
// scopeWorkerRoute() shape documents/routes.ts's four routes already establish.
function scopeWorkerRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Self-access is role-independent (2026-08-13). Previously this was
    // `role === 'worker'` only, from when a worker was the only applicant;
    // under ADR-065 a Manager/RM onboards too and has no scope of their own
    // until approval, so a role-keyed check would deny them their own
    // contract status. This currently also passes via checkWorkerScope()'s
    // own self-record branch, but relying on that leaves the correctness of
    // this route dependent on an unrelated guard's internals -- state the
    // self-exemption here, where the route's own intent lives.
    if (req.auth && req.auth.userId === req.params.worker_id) {
      next();
      return;
    }
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
    const requiredToken = (req.auth?.role === 'worker' || req.auth?.role === 'checker') ? 'hr:contract:read-own' : 'hr:read';
    requirePermission(requiredToken)(req, res, next);
  };
}

// ADR-042/OD-HR-10: worker access to IF-HR-ListPayroll MUST be gated by the
// dedicated hr:payslip:read-own token — NOT hr:read (which WORKER doesn't
// hold), and NOT hr:payslip:request (a write capability, not a read). Same
// role-conditional OR pattern as requireContractReadAccess() above.
// requirePermission()'s array form is AND-only and cannot express this
// cross-role split.
//
// @requiresPermission hr:read hr:payslip:read-own
function requirePayslipReadAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requiredToken = (req.auth?.role === 'worker' || req.auth?.role === 'checker') ? 'hr:payslip:read-own' : 'hr:read';
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
router.get('/contracts', requireRole(['admin', 'manager', 'regional_manager']), requirePermission('hr:read'), validateQuery(ListContractsQuerySchema), (req, res, next) =>
  hrController.listContracts(req, res, next)
);
router.post(
  '/contracts',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.createContract(req, res, next)
);

// Payroll (lists/creates PayslipRequest records — ADR-039, no payroll computation)
// IF-HR-ListPayroll: admin/manager see hotel-group-scoped results (ADR-043,
// via resolveNonAdminScopeFilter inside the service). Worker sees only their
// own requests — self-scope enforced in hrService.listPayroll (FIND-SEC-HR-03
// IDOR guard, actorId-override pattern mirroring getContractStatus).
router.get('/payroll', requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker']), requirePayslipReadAccess(), validateQuery(ListPayslipRequestsQuerySchema), (req, res, next) =>
  hrController.listPayroll(req, res, next)
);
router.post(
  '/payroll',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.createPayroll(req, res, next)
);

// IF-HR-FulfilPayslipRequest (RULE-HR-09, OD-HR-13): Manager/Admin marks a
// request emailed. Keyed on the request's own id, not a worker_id path
// param, so checkWorkerScope() cannot gate this route directly — the
// PayslipRequest row itself carries no hotel/group field. Group-scope
// enforcement (request -> worker_id -> EmploymentRecord.hotel_group_id ->
// caller's scope) happens inside hrService.fulfilPayslipRequest() itself,
// via the same isWorkerInGroupScope() primitive checkWorkerScope() calls —
// a manager cannot fulfil another hotel group's requests.
router.post(
  '/payroll/:request_id/fulfil',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('hr:write'),
  (req, res, next) => hrController.fulfilPayslipRequest(req, res, next)
);

// IF-HR-RequestPayslip (ADR-042: hr:payslip:request, self-scoped — worker_id
// is ALWAYS req.auth.userId, never a client-supplied field). Admin/Manager
// use POST /payroll above to create a request on a worker's behalf instead.
router.post(
  '/payslip-requests',
  requireRole(['worker', 'checker']),
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
  requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker']),
  requireContractReadAccess(),
  scopeWorkerRoute(),
  (req, res, next) => hrController.getContractStatus(req, res, next)
);

// 2026-08-13 contract feature: serves the single static default contract
// PDF. Same read gate as IF-HR-GetContractStatus immediately above --
// worker self-download (scopeWorkerRoute lets a worker through to no
// further check, matching getContractStatus's own worker-self-read shape),
// manager/RM via checkWorkerScope() group-scope, admin unscoped.
router.get(
  '/workers/:worker_id/contract-download',
  requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker']),
  requireContractReadAccess(),
  scopeWorkerRoute(),
  (req, res, next) => hrController.downloadDefaultContract(req, res, next)
);

// IF-HR-UploadSignedContract (RULE-HR-13/OD-HR-13): Manager/Admin only, per
// spec's own actor list; hotel-scope enforcement via checkWorkerScope(),
// same as every other HR write route.
router.post(
  '/workers/:worker_id/contract-scan',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  upload.single('file'),
  handleUploadErrors(),
  (req: Request, res: Response, next: NextFunction) => hrController.uploadSignedContract(req, res, next)
);

// IF-HR-ConfirmContractSigned (RULE-HR-03/13, OD-HR-13): Manager/Admin only.
router.post(
  '/workers/:worker_id/contract-confirm',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.confirmContractSigned(req, res, next)
);

// RULE-HR-06/07, ADR-040: manager-only continuation/permanence confirmation
// (extend) and explicit-decline lapse. Both Manager/Admin only, no
// worker-side veto (ADR-040 Decision §1/§3).
router.post(
  '/workers/:worker_id/contract-extend',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.extendContract(req, res, next)
);
router.post(
  '/workers/:worker_id/contract-lapse',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  (req, res, next) => hrController.manualLapseContract(req, res, next)
);

// Documents (contract-scan mechanism-class upload, MIG-GAP-DOC-001 — delegates
// to backend-documents' DocumentService rather than hosting the mechanism)
router.post(
  '/workers/:worker_id/documents',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('hr:write'),
  checkWorkerScope(),
  upload.single('file'),
  handleUploadErrors(),
  (req: Request, res: Response, next: NextFunction) => hrController.uploadDocument(req, res, next)
);

export default router;

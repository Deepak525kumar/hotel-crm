// SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16 Decided 2026-07-27).
// GD-16: self-upload (worker) + manager-upload only; hotel-scoped read.

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middleware/auth.js';
import { checkWorkerScope, requireRole } from '../../middleware/permissions.js';
import { documentController } from './controller.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from './upload-policy.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';

// RULE-DOC-09/REQ-DOC-017: memory storage only — bytes are handed straight to
// StorageService.upload() (S3 stub today, real S3 once wired), never written
// to local disk. fileFilter rejects disallowed MIME types before the upload
// even completes; limits.fileSize is defense-in-depth ahead of the service's
// own size re-check.
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

// GOVERNANCE NOTE — `regional_manager` added to all five role gates in this
// module by explicit project-owner decision (2026-08-04, Regional Manager V1
// scoping). This REVERSES `OD-DOC-007`/`GD-16`, which recorded broader
// Regional-Manager document access as "explicitly not adopted". The owner was
// shown the direct conflict between that record and `ADR-030` D-5 / PDD §5.4
// ("Regional Manager | All Hotel-Manager actions across the group") and chose
// D-5. `OD-DOC-007` must be superseded by a new Decision Record — tracked as
// PR6's documentation-synchronization step; until that record exists this
// comment is the authority trail for the change, not a substitute for it.
//
// checkWorkerScope() (permissions.ts resolveWorkerScope) allows admin (bypass)
// and the scope-bound manager roles (group-scope check via
// isScopedManagerRole) — every other role, including worker, is
// unconditionally denied. It was built for backend-hr's contract-scan routes
// and cannot express GD-16's worker-self-service requirement. Applying it in front of a
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

// RULE B (project-owner decision, 2026-08-12): upload is SELF-SERVICE ONLY.
// Enforced at the ROUTE as well as in DocumentService.uploadDocument — a
// hidden button in front of a live route is not a control, and this route
// previously admitted admin/manager/regional_manager for ANY :worker_id.
//
// Deliberately NOT `scopeWorkerRoute()`: that middleware asks "is this worker
// inside the actor's group", which is the wrong question now — an in-scope
// worker who is not the actor must still be denied. This asks the only
// question RULE B cares about, and asks it identically for every role
// (including admin, which checkWorkerScope() bypasses outright).
//
// Comparing `req.auth.userId` to the path parameter means the actor's identity
// comes from the verified JWT and the target from the URL; there is no body
// field a caller could use to claim someone else's id (RULE-DOC-08).
function requireSelfWorker() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(new ForbiddenError('Authentication required'));
      return;
    }
    if (req.auth.userId !== req.params.worker_id) {
      next(
        new ForbiddenError(
          'Documents may only be uploaded by the worker they belong to; no role may upload on another user\'s behalf'
        )
      );
      return;
    }
    next();
  };
}

// Translates multer's own MulterError into the platform's ValidationError
// shape (422, ERROR_CODES.VALIDATION_ERROR) so a rejected upload (oversize,
// disallowed MIME type, wrong field name) reaches the client in the same
// error contract as every other validation failure, instead of the generic
// handler's unexpected-error 500 fallback.
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

// RULE B: any authenticated role may upload, but ONLY to its own document set
// — so the role gate widens to include `checker` (a checker onboards too) while
// requireSelfWorker() supplies the real, tighter boundary. Widening the role
// list without the self-check would be a regression; the two land together.
router.post(
  '/workers/:worker_id/documents',
  requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker']),
  requireSelfWorker(),
  upload.single('file'),
  handleUploadErrors(),
  (req: Request, res: Response, next: NextFunction) => documentController.uploadDocument(req, res, next)
);

router.get(
  '/workers/:worker_id/documents',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  scopeWorkerRoute(),
  (req, res, next) => documentController.listWorkerDocuments(req, res, next)
);

router.get(
  '/workers/:worker_id/documents/completeness',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  scopeWorkerRoute(),
  (req, res, next) => documentController.getDocumentCompleteness(req, res, next)
);

router.get(
  '/workers/:worker_id/documents/export',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  scopeWorkerRoute(),
  (req, res, next) => documentController.exportWorkerDocuments(req, res, next)
);

// FIND-SEC-DOC-01: bare document id — ownership binding enforced in
// DocumentService.getDocument, not by a worker_id-keyed scope middleware.
router.get(
  '/documents/:document_id',
  requireRole(['admin', 'manager', 'regional_manager', 'worker']),
  (req, res, next) => documentController.getDocument(req, res, next)
);

export default router;

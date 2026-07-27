// SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16 Decided 2026-07-27).
// GD-16: self-upload (worker) + manager-upload only; hotel-scoped read.

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middleware/auth.js';
import { checkWorkerScope, requireRole } from '../../middleware/permissions.js';
import { documentController } from './controller.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from './validation.js';
import { ValidationError } from '../../lib/errors.js';

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

router.post(
  '/workers/:worker_id/documents',
  requireRole(['admin', 'manager', 'worker']),
  scopeWorkerRoute(),
  upload.single('file'),
  handleUploadErrors(),
  (req: Request, res: Response, next: NextFunction) => documentController.uploadDocument(req, res, next)
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

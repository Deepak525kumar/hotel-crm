// SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16 Decided 2026-07-27).
// GD-16: self-upload (worker) + manager-upload only; hotel-scoped read.

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import { documentController } from './controller.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from './upload-policy.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { isWorkerInReviewerScope } from '../../lib/scope.js';

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
// Worker self-access for these read routes is self-scoped in the service
// layer instead (DocumentService checks actor_id === worker_id for the
// 'worker' role) — the same split already used by calendar's /my-absences
// and employee-management's own-profile read.
//
// 2026-08-13 (review-queue reviewing gap, found while rebuilding the review
// queue UI): these three READ routes (list/completeness/export) used to go
// through checkWorkerScope() -> isWorkerInGroupScope(), which denies by
// design whenever EmploymentRecord.hotel_group_id is null -- true for every
// application still PENDING review, i.e. exactly the applicants a
// manager/RM's review queue exists to show. A reviewer opening the review
// modal for ANY not-yet-approved applicant got a 403 on document
// completeness, 100% of the time. Fixed with this NEW middleware rather than
// widening checkWorkerScope()/resolveWorkerScope() itself: that shared
// function also gates WRITE routes elsewhere (HR's contract-scan/confirm/
// extend/lapse), and this fix is read-only, reviewer-only, pre-approval-only
// by construction (isWorkerInReviewerScope falls through to the real
// post-approval group once hotel_group_id is set) -- widening the shared
// primitive would have risked loosening write authorization far outside
// this ticket's scope.
function scopeWorkerReadRoute() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    // SELF-ACCESS, role-independent (2026-08-13). This was previously
    // `role === 'worker'`, written when a worker was the only kind of
    // applicant. Under ADR-065 every non-admin role onboards -- so a Manager
    // or Regional Manager viewing their OWN onboarding fell through to the
    // scope check below, which cannot succeed for them: an applicant has no
    // hotel_group_id until approval, and an RM has no assigned group yet
    // either. The result was "Failed to load document status" on their own
    // My Onboarding page, 100% of the time.
    //
    // Keyed on identity, not role, precisely so the next role added does not
    // reintroduce this. useMyOnboarding's own header documents this same bug
    // class ("two separate visibility guards have broken by assuming a scope
    // exists for a manager-grade role") -- this was the third.
    if (req.auth.userId === req.params.worker_id) {
      next();
      return;
    }
    if (req.auth.role === 'admin') {
      next();
      return;
    }
    const workerId = req.params.worker_id;
    const inScope = await isWorkerInReviewerScope(req.auth.scope ?? null, workerId).catch(() => false);
    if (!inScope) {
      next(new ForbiddenError(`Cannot access worker ${workerId}`));
      return;
    }
    next();
  };
}

// RULE B (project-owner decision, 2026-08-12): upload is SELF-SERVICE ONLY.
// Enforced at the ROUTE as well as in DocumentService.uploadDocument — a
// hidden button in front of a live route is not a control, and this route
// previously admitted admin/manager/regional_manager for ANY :worker_id.
//
// Deliberately NOT a group-scope check: "is this worker inside the actor's
// group" is the wrong question for an upload — an in-scope worker who is not
// the actor must still be denied. This asks the only question RULE B cares
// about, and asks it identically for every role (including admin, which a
// group-scope check would otherwise bypass outright).
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
  requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker']),
  scopeWorkerReadRoute(),
  (req, res, next) => documentController.listWorkerDocuments(req, res, next)
);

router.get(
  '/workers/:worker_id/documents/completeness',
  requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker']),
  scopeWorkerReadRoute(),
  (req, res, next) => documentController.getDocumentCompleteness(req, res, next)
);

router.get(
  '/workers/:worker_id/documents/export',
  requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker']),
  scopeWorkerReadRoute(),
  (req, res, next) => documentController.exportWorkerDocuments(req, res, next)
);

// FIND-SEC-DOC-01: bare document id — ownership binding enforced in
// DocumentService.getDocument, not by a worker_id-keyed scope middleware.
router.get(
  '/documents/:document_id',
  requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker']),
  (req, res, next) => documentController.getDocument(req, res, next)
);

// 2026-08-13 (worker edit/replace fix): self-only, same shape as
// requireSelfWorker() above but keyed on the bare document id -- ownership
// is bound inside documentService.deleteDocument (actorId === doc.worker_id
// AND actorRole === 'worker'), not by a route-level worker_id param, since
// this route carries none (mirrors GET /documents/:document_id immediately
// above). No role other than worker is granted this route at all --
// reviewers (manager/RM/admin) remain view-only by construction, not by a
// narrower permission check that could later be widened by mistake.
router.delete(
  '/documents/:document_id',
  requireRole(['worker', 'checker']),
  (req, res, next) => documentController.deleteDocument(req, res, next)
);

export default router;

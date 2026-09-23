import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middleware/auth.js';
import { checkHotelAccess, requirePermission, requireRole } from '../../middleware/permissions.js';
import { qualityController } from './controller.js';
import {
  ALLOWED_PHOTO_MIME_TYPES,
  MAX_PHOTOS_PER_VERIFICATION,
  MAX_PHOTO_BYTES,
} from './types.js';

const router = Router();
router.use(authMiddleware);

// DISK storage, not memoryStorage (changed 2026-09-03).
//
// This was the worst of the four upload routes for memory: one inspection
// can carry MAX_PHOTOS_PER_VERIFICATION (6) files at MAX_PHOTO_BYTES (10 MB)
// each, so a SINGLE request could hold 60 MB of photo bytes in the heap at
// once. On the production t3.small (1906 MB total, ~1.1 GB actually free
// after the three pm2 processes) ten concurrent checker submissions at
// end-of-shift came to ~600 MB -- over half the remaining headroom, for a
// request pattern that is entirely normal.
//
// Staging to disk trades that for temp files on a host with 17 GB free, and
// the service streams each file to S3 rather than reading it back into a
// buffer. The service is responsible for unlinking them -- multer does NOT
// clean up diskStorage files itself, on success or on failure. See
// quality/service.ts's own `finally` for that.
//
// Limits are still enforced here AND in the service: multer aborts an
// oversized file mid-write, and the service re-checks `size` (what multer
// actually wrote) before uploading.
const photoUpload = multer({
  storage: multer.diskStorage({}),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_VERIFICATION },
  fileFilter: (_req, file, cb) => {
    if (!(ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'photos'));
      return;
    }
    cb(null, true);
  },
});

// CRR §15: the checker uploads a photo WITH the rating, so this accepts
// multipart. A request with no files still succeeds -- photos are optional at
// the transport layer.
router.post(
  '/verifications',
  requirePermission('quality:write'),
  photoUpload.array('photos', MAX_PHOTOS_PER_VERIFICATION),
  (req, res, next) => qualityController.createVerification(req, res, next)
);

// CRR §14/§15: presigned URLs for one inspection's evidence. quality:read
// rather than quality:write -- managers and RMs hold read and must be able to
// see what an inspection recorded. The worker the inspection is ABOUT is
// admitted in the service, which is the layer that knows whose assignment it
// is.
// The inspection record. quality:read, same gate as its photos below — the
// record and the evidence attached to it are one disclosure.
router.get('/verifications/:verification_id', requirePermission('quality:read'), (req, res, next) =>
  qualityController.getVerification(req, res, next)
);

router.get('/verifications/:verification_id/photos', requirePermission('quality:read'), (req, res, next) =>
  qualityController.getVerificationPhotos(req, res, next)
);

// CRR §14: checker assigns rework to a specific worker.
router.post('/rework', requirePermission('quality:write'), (req, res, next) =>
  qualityController.assignRework(req, res, next)
);

// CRR §14: the worker uploads a photo and marks it done. Deliberately NOT
// gated on quality:write -- the checker inspects, the worker completes.
// Self-scoping is enforced in the service, where the assignment owner is known.
router.post(
  '/rework/:assignment_id/complete',
  photoUpload.array('photos', MAX_PHOTOS_PER_VERIFICATION),
  (req, res, next) => qualityController.completeRework(req, res, next)
);
// One inspection, one request. Writes the QualityVerification -- checklist,
// photos, score and outcome -- plus the rework assignment when the checker
// asks for one, in a single transaction from a single upload.
//
// POST /ratings and GET /ratings/:id/photos were removed 2026-08-29 when
// Rating was merged into this model: one visit no longer writes two records,
// so there is no second record to create or to fetch photos for. The checklist
// those routes carried now lives on the verification and arrives here.
router.post(
  '/inspections',
  requirePermission('quality:write'),
  photoUpload.array('photos', MAX_PHOTOS_PER_VERIFICATION),
  (req, res, next) => qualityController.recordInspection(req, res, next)
);

// ADR-072 §2.5: the worker picker that starts an inspection. quality:write,
// not quality:read — this is the entry point to inspecting, and a manager (who
// holds read but not write) does not run inspections. Scope is resolved in the
// service, which is the layer that knows a checker's JWT carries no scope claim.
router.get('/inspectable-workers', requirePermission('quality:write'), (req, res, next) =>
  qualityController.listInspectableWorkers(req, res, next)
);

// CRR §14/§15: the checker's own inspection history — the shifts they scored,
// newest first. `/my-` prefix and no role gate beyond the permission token,
// matching calendar's /my-absences and analytics' /my-stats: self-scope IS the
// authorization here, because the service filters on the caller's own id and
// accepts no actor parameter from the client.
//
// quality:read rather than quality:write, even though only a quality:write
// holder can have authored anything: the token gates a READ, and a role that
// never inspected simply gets an empty list. Gating a read behind a write
// token would be the wrong shape to copy the next time this file grows.
router.get('/my-inspections', requirePermission('quality:read'), (req, res, next) =>
  qualityController.listOwnChecks(req, res, next)
);

// The management-facing inspection history (2026-09-23). Distinct from
// /my-inspections above, which filters on the caller's OWN verified_by_id:
// that is right for a checker and empty forever for a manager or admin, who
// never record inspections. The web's History tab called the self-scoped one
// and so was permanently blank for the roles it admitted.
//
// requireRole with all THREE management strings. `['admin', 'manager']` omits
// regional_manager silently -- the RM just finds the door locked, with no
// error anywhere. Scope itself is resolved in the service from req.auth.
router.get(
  '/checks',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('quality:read'),
  (req, res, next) => qualityController.listChecksInScope(req, res, next)
);

// Every check recorded against one shift. NOT gated on quality:read: the
// WORKER whose shift it is must be able to see the inspections of their own
// work (CRR §14 says they are notified with the detail), and a worker does
// hold quality:read -- but the authoritative gate is in the service, which
// knows whose assignment it is. Keeping the token here as well would deny
// nobody and imply the route is manager-facing, which it is not.
router.get('/assignments/:assignment_id/checks', (req, res, next) =>
  qualityController.listChecksForAssignment(req, res, next)
);

// One check, in the shape both sides render. Same reasoning as above for the
// absent permission gate -- the subject of an inspection may always read it.
router.get('/checks/:check_id', (req, res, next) =>
  qualityController.getCheck(req, res, next)
);

// The check a rework shift corrects, addressed BY the shift. The worker
// standing in the room has the rework assignment id and nothing else; without
// this they see only the one-line note the push carried, with no picture of
// what was actually wrong. No permission gate, same as /checks/:id above: the
// subject of an inspection may always read it, and the service applies the
// identical view check.
router.get('/rework-assignments/:assignment_id/check', (req, res, next) =>
  qualityController.getCheckForRework(req, res, next)
);

router.get('/leaderboard', requirePermission('quality:read'), (req, res, next) =>
  qualityController.getLeaderboard(req, res, next)
);
router.get('/leaderboard/by-hotel/:hotel_id', requirePermission('quality:read'), checkHotelAccess(), (req, res, next) =>
  qualityController.getLeaderboard(req, res, next)
);

export default router;

import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middleware/auth.js';
import { checkHotelAccess, requirePermission } from '../../middleware/permissions.js';
import { qualityController } from './controller.js';
import {
  ALLOWED_PHOTO_MIME_TYPES,
  MAX_PHOTOS_PER_VERIFICATION,
  MAX_PHOTO_BYTES,
} from './types.js';

const router = Router();
router.use(authMiddleware);

// Memory storage, same convention as documents/routes.ts and hr/routes.ts.
// Limits are enforced here AND in the service: multer rejects an oversized
// file before it is fully buffered, the service check runs once the bytes are
// already in memory.
const photoUpload = multer({
  storage: multer.memoryStorage(),
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
// CRR §15: same "checker/supervisor uploads a photo WITH the rating"
// requirement as /verifications above — Rating is the checklist-based score
// that actually feeds WorkerOverallRating (see quality/service.ts
// refreshWorkerOverallRating), so the requirement is enforced here too
// (2026-08-24). A request with no files still succeeds at the transport
// layer; the service enforces at least one.
router.post(
  '/ratings',
  requirePermission('quality:write'),
  photoUpload.array('photos', MAX_PHOTOS_PER_VERIFICATION),
  (req, res, next) => qualityController.createRating(req, res, next)
);

// One inspection, one request (2026-08-29). Writes the Rating AND the
// QualityVerification -- plus the rework assignment when the checker asks for
// one -- in a single transaction from a single photo upload.
//
// The two single-record routes above are deliberately kept: the web still uses
// them, and POST /verifications remains the way to add a pass/fail check to an
// inspection that was only rated.
router.post(
  '/inspections',
  requirePermission('quality:write'),
  photoUpload.array('photos', MAX_PHOTOS_PER_VERIFICATION),
  (req, res, next) => qualityController.recordInspection(req, res, next)
);

// Presigned URLs for one rating's evidence — same shape as
// /verifications/:id/photos above, quality:read rather than quality:write for
// the identical reason (managers/RMs hold read and must be able to see what
// a rating recorded).
router.get('/ratings/:rating_id/photos', requirePermission('quality:read'), (req, res, next) =>
  qualityController.getRatingPhotos(req, res, next)
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
  qualityController.listOwnInspections(req, res, next)
);

router.get('/leaderboard', requirePermission('quality:read'), (req, res, next) =>
  qualityController.getLeaderboard(req, res, next)
);
router.get('/leaderboard/by-hotel/:hotel_id', requirePermission('quality:read'), checkHotelAccess(), (req, res, next) =>
  qualityController.getLeaderboard(req, res, next)
);

export default router;

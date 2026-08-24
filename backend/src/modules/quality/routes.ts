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
// Inspection history. Scoped in the service per role — see listVerifications.
// Registered BEFORE '/verifications/:verification_id' so the literal path is
// not captured as an id (Express matches in registration order).
router.get('/verifications', requirePermission('quality:read'), (req, res, next) =>
  qualityController.listVerifications(req, res, next)
);

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

// Presigned URLs for one rating's evidence — same shape as
// /verifications/:id/photos above, quality:read rather than quality:write for
// the identical reason (managers/RMs hold read and must be able to see what
// a rating recorded).
router.get('/ratings/:rating_id/photos', requirePermission('quality:read'), (req, res, next) =>
  qualityController.getRatingPhotos(req, res, next)
);
router.get('/leaderboard', requirePermission('quality:read'), (req, res, next) =>
  qualityController.getLeaderboard(req, res, next)
);
router.get('/leaderboard/by-hotel/:hotel_id', requirePermission('quality:read'), checkHotelAccess(), (req, res, next) =>
  qualityController.getLeaderboard(req, res, next)
);

export default router;

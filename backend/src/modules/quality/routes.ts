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
router.post('/ratings', requirePermission('quality:write'), (req, res, next) =>
  qualityController.createRating(req, res, next)
);
router.get('/leaderboard', requirePermission('quality:read'), (req, res, next) =>
  qualityController.getLeaderboard(req, res, next)
);
router.get('/leaderboard/by-hotel/:hotel_id', requirePermission('quality:read'), checkHotelAccess(), (req, res, next) =>
  qualityController.getLeaderboard(req, res, next)
);

export default router;

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { checkHotelAccess, requirePermission } from '../../middleware/permissions.js';
import { qualityController } from './controller.js';

const router = Router();
router.use(authMiddleware);

router.post('/verifications', requirePermission('quality:write'), (req, res, next) =>
  qualityController.createVerification(req, res, next)
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

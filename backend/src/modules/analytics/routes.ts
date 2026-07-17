import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { checkHotelAccess, requireRole } from '../../middleware/permissions.js';
import { analyticsController } from './controller.js';

const router = Router();
router.use(authMiddleware);

router.get(
  '/leaderboard',
  requireRole(['admin', 'manager']),
  (req, res, next) => analyticsController.getLeaderboard(req, res, next)
);
router.get(
  '/leaderboard/by-hotel/:hotel_id',
  requireRole(['admin', 'manager']),
  checkHotelAccess(),
  (req, res, next) => analyticsController.getLeaderboard(req, res, next)
);
router.get(
  '/stats',
  requireRole(['admin', 'manager']),
  (req, res, next) => analyticsController.getDashboardStats(req, res, next)
);
router.get(
  '/hotel-summary/:hotel_id',
  requireRole(['admin', 'manager']),
  (req, res, next) => analyticsController.getHotelSummary(req, res, next)
);

export default router;

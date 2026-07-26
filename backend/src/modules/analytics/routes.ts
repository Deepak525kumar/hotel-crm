import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { checkHotelAccess, requireRole } from '../../middleware/permissions.js';
import { analyticsController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// KNOWN GAP (security review FIND-02, tracked, fail-closed): 'regional_manager'
// is not yet in the requireRole lists below. Harmless today — FEATURE_RM_ROLE
// is off, so no live user holds that role — but once it's enabled, a
// regional_manager will 403 here despite resolveScopedFilter (controller.ts)
// already being ready to scope them. Must be added alongside PR-5 (ADR-030 §6).
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
  checkHotelAccess(),
  (req, res, next) => analyticsController.getHotelSummary(req, res, next)
);

export default router;

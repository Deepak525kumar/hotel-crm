import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { checkHotelAccess, requirePermission, requireRole } from '../../middleware/permissions.js';
import { analyticsController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// ADR-030 PR-7 follow-up: closes the gap the security review (FIND-02) and
// PR-7's generated route x role matrix both flagged — 'regional_manager' is
// now included (C-31, D-5: RM holds analytics:read at group scope, scoped by
// resolveScopedFilter in controller.ts) and each route now also checks the
// named 'analytics:read' token (previously role-only with no accompanying
// requirePermission call, even though ROLE_PERMISSIONS names analytics:read
// as C-31's token).
router.get(
  '/leaderboard',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('analytics:read'),
  (req, res, next) => analyticsController.getLeaderboard(req, res, next)
);
router.get(
  '/leaderboard/by-hotel/:hotel_id',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('analytics:read'),
  checkHotelAccess(),
  (req, res, next) => analyticsController.getLeaderboard(req, res, next)
);
router.get(
  '/stats',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('analytics:read'),
  (req, res, next) => analyticsController.getDashboardStats(req, res, next)
);
// GD-06: worker-scoped, self-only — any authenticated role, no
// admin/manager permission gate. Deliberately does not ride /stats' guard.
router.get(
  '/my-stats',
  (req, res, next) => analyticsController.getMyStats(req, res, next)
);
router.get(
  '/hotel-summary/:hotel_id',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('analytics:read'),
  checkHotelAccess(),
  (req, res, next) => analyticsController.getHotelSummary(req, res, next)
);

export default router;

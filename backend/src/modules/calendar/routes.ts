import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { checkHotelAccess, requireRole } from '../../middleware/permissions.js';
import { calendarController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// ADR-030 PR-1 (C-13): both routes previously carried checkHotelAccess() only
// — no role gate — so any worker on the hotel's roster could reach the write
// path (and the read path) for what CRR §19 documents as manager-entered
// reception/operations data. Adds the missing role gate; checkHotelAccess()'s
// existing hotel-scope behavior for admin/manager is unchanged.
router.get(
  '/hotels/:hotel_id/operations',
  requireRole(['admin', 'manager']),
  checkHotelAccess(),
  (req, res, next) => calendarController.getDailyOperations(req, res, next)
);
router.post(
  '/hotels/:hotel_id/operations',
  requireRole(['admin', 'manager']),
  checkHotelAccess(),
  (req, res, next) => calendarController.createDailyOperation(req, res, next)
);

// REQ-CAL-T02/T03: self-scoped -- any authenticated role, no admin/manager
// gate (self-scope is itself the authorization, same pattern as GD-06's
// /analytics/my-stats).
router.get('/my-absences', (req, res, next) => calendarController.getOwnAbsences(req, res, next));
router.post('/my-absences', (req, res, next) => calendarController.markAbsence(req, res, next));

// REQ-CAL-T06/RULE-CAL-08 (IF-CAL-GetAvailability/v0, ADR-021 "OD-CAL-01
// RESOLVED"): no route-level role gate -- worker_id defaults to the caller
// (self-scope is itself the authorization, same as /my-absences above), and
// CalendarService.getAvailability() enforces the read-model's own permission
// matrix (self; admin/checker cross-hotel; manager/regional_manager via the
// worker's EmploymentRecord.hotel_group_id) for every other worker_id.
router.get('/availability', (req, res, next) => calendarController.getAvailability(req, res, next));

export default router;

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import { calendarController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// REQ-CAL-T02/T03: self-scoped -- any authenticated role, no admin/manager
// gate (self-scope is itself the authorization, same pattern as GD-06's
// /analytics/my-stats).
router.get('/my-absences', (req, res, next) => calendarController.getOwnAbsences(req, res, next));
router.post('/my-absences', (req, res, next) => calendarController.markAbsence(req, res, next));

// New (calendar grid view): manager/regional_manager/admin view of absences
// across their scoped team, for a bounded date range. View-only -- no write
// path for marking a worker's absence on their behalf (REQ-CAL-T03's
// self-service-only model is unchanged). Role gate matches the calendar
// operations routes above; scope narrowing happens in the service
// (resolveNonAdminScopeFilter -> hotel_group_id, same primitive
// listCalendarEntries/analytics use).
router.get(
  '/absences',
  requireRole(['admin', 'manager', 'regional_manager']),
  (req, res, next) => calendarController.listAbsences(req, res, next)
);

// REQ-CAL-T06/RULE-CAL-08 (IF-CAL-GetAvailability/v0, ADR-021 "OD-CAL-01
// RESOLVED"): no route-level role gate -- worker_id defaults to the caller
// (self-scope is itself the authorization, same as /my-absences above), and
// CalendarService.getAvailability() enforces the read-model's own permission
// matrix (self; admin all; manager/regional_manager via the worker's
// EmploymentRecord.hotel_group_id) for every other worker_id. Checker is
// deliberately denied for any worker but itself, NOT given the cross-hotel
// bypass checkHotelAccess() grants it elsewhere -- see the service method's
// own comment for why that bypass doesn't transfer to this permission.
router.get('/availability', (req, res, next) => calendarController.getAvailability(req, res, next));

export default router;

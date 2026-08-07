import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { checkHotelAccess, requireRole, requirePermission } from '../../middleware/permissions.js';
import { calendarController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// ADR-030 PR-1 (C-13): both routes previously carried checkHotelAccess() only
// — no role gate — so any worker on the hotel's roster could reach the write
// path (and the read path) for what CRR §19 documents as manager-entered
// reception/operations data. Adds the missing role gate; checkHotelAccess()'s
// existing hotel-scope behavior for admin/manager is unchanged.
//
// `regional_manager` added per ADR-050 D-1, which ratified RM calendar editing
// at hotel-group scope (resolved via HotelGroup.regional_manager_user_id), and
// ADR-030 §3 C-25 (token `staffing:write`). Calendar's own MODULE_SPEC still
// records this as OD-CAL-07 `[OPEN]`; ADR-050 superseded that and the spec body
// was never updated — see PR6's documentation sync. checkHotelAccess() is
// already group-aware for an RM via resolveHotelAccess().
router.get(
  '/hotels/:hotel_id/operations',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('staffing:write'),
  checkHotelAccess(),
  (req, res, next) => calendarController.getDailyOperations(req, res, next)
);
router.post(
  '/hotels/:hotel_id/operations',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('staffing:write'),
  checkHotelAccess(),
  (req, res, next) => calendarController.createDailyOperation(req, res, next)
);

// REQ-CAL-T02/T03: self-scoped -- any authenticated role, no admin/manager
// gate (self-scope is itself the authorization, same pattern as GD-06's
// /analytics/my-stats).
router.get('/my-absences', (req, res, next) => calendarController.getOwnAbsences(req, res, next));
router.post('/my-absences', (req, res, next) => calendarController.markAbsence(req, res, next));

// New (calendar grid view): manager/regional_manager/admin view of absences
// across their scoped team, for a bounded date range. Role gate matches the
// calendar operations routes above; scope narrowing happens in the service
// (resolveNonAdminScopeFilter -> hotel_group_id, same primitive
// listCalendarEntries/analytics use).
router.get(
  '/absences',
  requireRole(['admin', 'manager', 'regional_manager']),
  (req, res, next) => calendarController.listAbsences(req, res, next)
);

// Manager/RM/admin marks or corrects an absence on a worker's behalf
// (2026-08-08 feature: "both manager and the worker should be able to mark
// attendance"). REQ-CAL-T03's self-service model (/my-absences above) is
// unchanged and remains the worker's own path; this is the new,
// group-scoped counterpart. Group-scope enforcement
// (isWorkerInGroupScope) happens in the service, same as every other
// manager-on-a-worker's-behalf write in this codebase.
router.post(
  '/absences',
  requireRole(['admin', 'manager', 'regional_manager']),
  (req, res, next) => calendarController.markAbsenceForWorker(req, res, next)
);

// Drag-to-move on the calendar grid (2026-08-08 feature). Self-service (the
// owning worker) or a manager/RM/admin acting on the worker's behalf --
// same actor set /my-absences and /absences (POST) admit; the service's own
// ownership/group-scope check (moveAbsence()) is the real gate, matching
// the pattern assignments/routes.ts's PATCH /:id uses (no route-level role
// restriction beyond authentication).
router.patch(
  '/absences/:id/move',
  (req, res, next) => calendarController.moveAbsence(req, res, next)
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

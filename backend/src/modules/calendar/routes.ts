import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission, requireRole } from '../../middleware/permissions.js';
import { calendarController } from './controller.js';
import { router as shiftSummaryRoutes } from './shift-summary/routes.js';

const router = Router();
router.use(authMiddleware);

// REQ-CAL-T02/T03: self-scoped -- any authenticated role, no admin/manager
// gate (self-scope is itself the authorization, same pattern as GD-06's
// /analytics/my-stats).
router.get('/my-absences', (req, res, next) => calendarController.getOwnAbsences(req, res, next));
// `calendar:absence:write-own` (2026-09-04) — held by EVERY role, so this
// denies nobody who could call it before. It is enforced rather than assumed
// so the capability is nameable: a chatbot tool must declare a real
// permission, and until this token existed the safest write on the platform
// (a person declaring their own sick day) could not be exposed at all.
// Same "satisfied by construction" pattern as ADR-042/OD-HR-10's
// hr:contract:read-own. Self-scope remains the substantive control —
// markAbsence takes the worker id from the caller and supplies its own actor.
router.post(
  '/my-absences',
  requirePermission('calendar:absence:write-own'),
  (req, res, next) => calendarController.markAbsence(req, res, next)
);

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
// @requiresPermission calendar:absence:write-team
router.post(
  '/absences',
  requireRole(['admin', 'manager', 'regional_manager']),
  // Added 2026-09-07 alongside the token itself. A NO-OP for HTTP callers:
  // the token is held by exactly the three roles requireRole already admits,
  // so nobody who could reach this route before is turned away now.
  //
  // It is here so the capability is nameable rather than implied by a role
  // list -- the same argument that added `calendar:absence:write-own` to the
  // self path above. Without it, the chatbot tool wrapping this endpoint
  // would have to declare a token this route does not check (a lie about the
  // real gate) or `null` (which the registry rightly refuses for a write).
  requirePermission('calendar:absence:write-team'),
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

// Delete an absence (Bug 8). Self-service (owning worker) or manager/RM/admin.
router.delete(
  '/absences/:id',
  (req, res, next) => calendarController.deleteAbsence(req, res, next)
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

// Daily Shift Summary (ADR-051 revival / Intake Pass)
router.use('/hotels/:hotel_id/shift-summaries', shiftSummaryRoutes);

export default router;

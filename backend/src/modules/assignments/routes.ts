import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole, requirePermission } from '../../middleware/permissions.js';
import { isJobDispatchPhase2Enabled } from '../../config/feature-flags.js';
import {
  createCalendarEntry,
  getAssignment,
  listAssignments,
  listCalendarEntries,
  logRoomsCompleted,
  updateAssignment,
} from './controller.js';

const router = Router();

router.use(authMiddleware);

// Epic 9 PR 9.5 (TREQ-001/TRULE-001, MIG-GAP-03): calendar direct-assignment.
// Registered ahead of the `/:id` routes below so `/calendar-entries` is never
// shadowed as a path param (Express matches routes in registration order).
// Gated by FEATURE_JOBDISPATCH_PHASE2 (default OFF) — while disabled, both
// routes fall through to the 404 handler, matching this repo's existing
// "both-off = current behavior" posture (routes/v1/index.ts's
// isEmploymentRecordEnabled() gate is the precedent this mirrors).
// RBAC: admin/manager/regional_manager per TREQ-008 (role x scope); the
// inline isHotelInScope() check in the service does the scope-authz, same
// shape as the rooms-completed route below.
router.post(
  '/calendar-entries',
  (req, res, next) => {
    if (!isJobDispatchPhase2Enabled()) {
      next();
      return;
    }
    requireRole(['admin', 'manager', 'regional_manager'])(req, res, next);
  },
  (req, res, next) => {
    if (!isJobDispatchPhase2Enabled()) {
      next();
      return;
    }
    createCalendarEntry(req, res, next);
  }
);

router.get('/calendar-entries', (req, res, next) => {
  if (!isJobDispatchPhase2Enabled()) {
    next();
    return;
  }
  listCalendarEntries(req, res, next);
});

// RBAC per API_SPEC_V1_PATCH_V2 §PATCH-07:
// Read: all authenticated roles (service scopes workers to their own assignments).
// Update (start/complete/cancel): all authenticated roles with service-level guards.
router.get('/', listAssignments);
router.get('/:id', getAssignment);
router.patch('/:id', updateAssignment);

// ADR-028 (OQ-ANALYTICS-03): manager-entered "rooms completed" count. RBAC
// mirrors analytics'/quality's manager-write precedent (Epic 5 PR 5.5, ADR-024):
// requireRole(['admin','manager']) at the route, plus an inline hotel-scope
// check in the service (assignment_id, not hotel_id, is the path param here,
// so checkHotelAccess() can't read hotel_id off the URL — same shape as
// quality/routes.ts POST /verifications and /ratings).
// `regional_manager` added per ADR-030 §3 C-24 (Manage assignments — RM
// `✓ᶜ`, token `staffing:write`). The sibling POST /calendar-entries on this
// same router already admitted it, and the service's own guard already handles
// RM — the route gate was the sole blocker.
router.post(
  '/:id/rooms-completed',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('staffing:write'),
  logRoomsCompleted
);

export default router;

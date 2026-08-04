import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole, requirePermission } from '../../middleware/permissions.js';
import { isJobDispatchPhase2Enabled } from '../../config/feature-flags.js';
import {
  acceptBroadcast,
  createWorkRequest,
  getBroadcastEligibility,
  getWorkRequest,
  listWorkRequests,
  manualCloseBroadcast,
  raiseBroadcast,
  updateWorkRequest,
} from './controller.js';

const router = Router();

router.use(authMiddleware);

// Epic 9 PR 9.7 (TREQ-002/TRULE-002, MIG-GAP-04/05): broadcast raise +
// eligibility. Registered ahead of the `/:id` routes below so `/broadcasts`
// is never shadowed as a path param (Express matches routes in registration
// order — same reasoning assignments/routes.ts uses for `/calendar-entries`).
// Gated by FEATURE_JOBDISPATCH_PHASE2 (default OFF) — while disabled, both
// routes fall through to the 404 handler, matching this repo's existing
// "both-off = current behavior" posture.
// RBAC: admin/manager/regional_manager per ADR-030 §3 C-23 (Manage work
// requests — RM `✓ᶜ`, token `staffing:write`); the inline isHotelInScope()
// check in the service does the scope-authz. `regional_manager` and the
// `staffing:write` gate were both absent: RM was denied at the role gate
// despite holding the ratified token, and the token itself was checked by no
// route anywhere (tracked as known debt in __tests__/support/known-debt.ts).
router.post(
  '/broadcasts',
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
    requirePermission('staffing:write')(req, res, next);
  },
  (req, res, next) => {
    if (!isJobDispatchPhase2Enabled()) {
      next();
      return;
    }
    raiseBroadcast(req, res, next);
  }
);

router.get('/broadcasts/:id/eligibility', (req, res, next) => {
  if (!isJobDispatchPhase2Enabled()) {
    next();
    return;
  }
  getBroadcastEligibility(req, res, next);
});

// Epic 9 PR 9.9 (TREQ-004/TREQ-005, MIG-GAP-06): worker accepts one skill
// slot on a broadcast. No requireRole gate (any authenticated role) — this
// is a worker-initiated action, not a manager one; the service enforces
// worker roster-eligibility, skill match, and daily-exclusivity itself
// (same shape as getBroadcastEligibility()'s own no-requireRole route
// above, and getWorkRequest()'s worker-facing read below).
router.post('/broadcasts/:id/accept', (req, res, next) => {
  if (!isJobDispatchPhase2Enabled()) {
    next();
    return;
  }
  acceptBroadcast(req, res, next);
});

// Epic 9 PR 9.10 (TREQ-006/TRULE-005, MIG-GAP-09): manager manually closes
// an unfilled broadcast before the 6h auto-close job would. RBAC mirrors
// raiseBroadcast()'s route above (manager-initiated); the inline
// isHotelInScope() check in the service does the scope-authz.
router.post(
  '/broadcasts/:id/close',
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
    requirePermission('staffing:write')(req, res, next);
  },
  (req, res, next) => {
    if (!isJobDispatchPhase2Enabled()) {
      next();
      return;
    }
    manualCloseBroadcast(req, res, next);
  }
);

// RBAC per API_SPEC_V1_PATCH_V2 §PATCH-07g, extended to ADR-030 §3 C-23.
// Create / mutate: ADMIN, MANAGER, REGIONAL_MANAGER (+ `staffing:write`).
// Read: all authenticated roles (results are scoped to roster membership for
// non-management in the service).
router.post('/', requireRole(['admin', 'manager', 'regional_manager']), requirePermission('staffing:write'), createWorkRequest);
router.get('/', listWorkRequests);
router.get('/:id', getWorkRequest);
router.patch('/:id', requireRole(['admin', 'manager', 'regional_manager']), requirePermission('staffing:write'), updateWorkRequest);

export default router;

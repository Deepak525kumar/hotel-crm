import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import { isJobDispatchPhase2Enabled } from '../../config/feature-flags.js';
import {
  createWorkRequest,
  getBroadcastEligibility,
  getWorkRequest,
  listWorkRequests,
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
// RBAC: admin/manager per this module's existing create()/update() RBAC
// shape (API_SPEC_V1_PATCH_V2 §PATCH-07g); the inline isHotelInScope() check
// in the service does the scope-authz.
router.post(
  '/broadcasts',
  (req, res, next) => {
    if (!isJobDispatchPhase2Enabled()) {
      next();
      return;
    }
    requireRole(['admin', 'manager'])(req, res, next);
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

// RBAC per API_SPEC_V1_PATCH_V2 §PATCH-07g.
// Create / mutate: ADMIN, MANAGER. Read: all authenticated roles
// (results are scoped to roster membership for non-management in the service).
router.post('/', requireRole(['admin', 'manager']), createWorkRequest);
router.get('/', listWorkRequests);
router.get('/:id', getWorkRequest);
router.patch('/:id', requireRole(['admin', 'manager']), updateWorkRequest);

export default router;

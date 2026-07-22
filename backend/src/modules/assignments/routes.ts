import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import { listAssignments, getAssignment, updateAssignment, logRoomsCompleted } from './controller.js';

const router = Router();

router.use(authMiddleware);

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
router.post('/:id/rooms-completed', requireRole(['admin', 'manager']), logRoomsCompleted);

export default router;

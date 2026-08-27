import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import { checkIn, listAttendance, getAttendanceById, updateAttendance } from './controller.js';

const router = Router();

router.use(authMiddleware);

// RBAC per API_SPEC_V1_PATCH_V2 §PATCH-07:
// Check-in: the roles that work a shift. Read: all authenticated (service scopes
// non-management to own). Update (check-out / verify): all authenticated (service
// guards field-level access).
//
// 'checker' added 2026-08-27: a checker works a shift like a worker does, and
// inspecting rooms is now gated on being checked in to it, so the role that
// could not check in at all could not start work either. Widening this gate
// grants nothing extra by itself -- checkIn() already refuses any assignment
// whose worker_id is not the caller ('Can only check in to your own
// assignment'), so a checker can still only check into their own shift, and
// the geofence applies to them exactly as it does to a worker.
router.post('/', requireRole(['worker', 'checker']), checkIn);
router.get('/', listAttendance);
router.get('/:id', getAttendanceById);
router.patch('/:id', updateAttendance);

export default router;

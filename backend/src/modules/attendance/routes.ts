import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission, requireRole } from '../../middleware/permissions.js';
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
// @requiresPermission attendance:write-own
// Added 2026-09-08 with the token itself. A NO-OP for HTTP callers: WORKER
// and CHECKER are exactly the roles requireRole already admits and exactly
// the roles granted the token, so nobody who could reach this before is
// turned away now. It exists so the capability is nameable -- a chatbot write
// tool may not declare `null`, and an unnamed capability cannot be offered.
router.post('/', requireRole(['worker', 'checker']), requirePermission('attendance:write-own'), checkIn);
router.get('/', listAttendance);
router.get('/:id', getAttendanceById);
// Deliberately NOT gated on attendance:write-own. This route is the manager's
// verification/correction path as well as the worker's own check-out, and
// managers do not hold that token -- adding it here would lock them out of
// timesheet correction entirely. The service already branches on role
// (isSelfScopedRole -> own record, check_out_at and notes only), which is the
// real boundary; the chatbot's check-out tool re-declares the self token and
// reaches only the self branch.
router.patch('/:id', updateAttendance);

export default router;

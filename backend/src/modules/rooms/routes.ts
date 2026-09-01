import { Router } from 'express';
import { roomController } from './controller.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole, requirePermission } from '../../middleware/permissions.js';

/**
 * Worker room logging + the checker's room picker (owner decision, 2026-09-01).
 *
 * PERMISSION NOTE: `rooms:read`/`rooms:write` existed in ROLE_PERMISSIONS but
 * were checked by ZERO routes -- recorded as dead tokens in
 * `__tests__/support/known-debt.ts`, whose own instructions say remediation
 * means "wiring the missing requirePermission gate onto the relevant
 * route(s)". These routes are that wiring, so both tokens leave that list in
 * the same change. `rooms:write` is additionally granted to WORKER: the worker
 * is the only role that writes here, and was the only role holding
 * `rooms:read` without it.
 *
 * Every route below is ALSO scope-enforced in the service layer, and that is
 * the real boundary:
 *  - a worker may only log/edit/remove rooms on their OWN shift (identity
 *    check against req.auth, not a role check);
 *  - a checker sees only hotels where they are rostered and active that day;
 *  - a manager/regional_manager sees only their JWT scope;
 *  - an admin sees everything.
 * The role gates here narrow who may reach the route at all; they cannot
 * express "your own shift" or "your own hotel", which is why neither is left
 * to them alone.
 */
const router = Router();

router.use(authMiddleware);

// --- Worker's own log -------------------------------------------------------

// `worker` only, deliberately. A checker inspects rooms, they do not clean
// them, so granting them a write here would be designing for a case that does
// not exist -- and `rooms:write` is granted to exactly one role for that
// reason. The service's identity check (assignment.worker_id === caller) is
// the real boundary; this gate only decides who reaches it.
router.post(
  '/assignments/:assignment_id/rooms',
  requireRole('worker'),
  requirePermission('rooms:write'),
  ...roomController.logRoom
);
router.put(
  '/logs/:room_log_id',
  requireRole('worker'),
  requirePermission('rooms:write'),
  ...roomController.updateRoom
);
router.delete(
  '/logs/:room_log_id',
  requireRole('worker'),
  requirePermission('rooms:write'),
  (req, res, next) => roomController.deleteRoom(req, res, next)
);

// The worker's room tab. Self-scoped by construction -- it reads
// `req.auth.userId` and takes no worker_id parameter at all, so there is no
// version of this request that returns somebody else's rooms.
router.get('/mine', requirePermission('rooms:read'), ...roomController.listMyRooms);

// --- Checker's picker and manager's live view -------------------------------

// The checker's room picker: what replaced their free-text room field.
// Deliberately admits manager/regional_manager/admin too -- the web
// inspection modal uses the same picker, and each is scoped in-service.
router.get(
  '/for-check',
  requireRole(['checker', 'manager', 'regional_manager', 'admin']),
  requirePermission('rooms:read'),
  ...roomController.listRoomsForPicker
);

// Manager/RM live view: rooms logged today at my hotels, per worker. This is
// what replaces the manual rooms-completed count.
router.get(
  '/for-hotels',
  requireRole(['manager', 'regional_manager', 'admin']),
  requirePermission('rooms:read'),
  ...roomController.listRoomsForHotels
);

// Typeahead of room numbers already used at a hotel -- what makes the
// deliberately-conservative room-key normalisation sufficient.
router.get('/suggestions', requirePermission('rooms:read'), ...roomController.listSuggestions);

export default router;

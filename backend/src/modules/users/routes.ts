import { Router } from 'express';
import { userController } from './controller.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole, requirePermission } from '../../middleware/permissions.js';

const router = Router();

router.use(authMiddleware);

router.get('/', requirePermission('users:read'), ...userController.listUsers);
// D-4's `users:write` grant to MANAGER/REGIONAL_MANAGER covers the *profile*
// route below only — D-4 explicitly carves account creation out as
// Admin-only, permanently, not just "until M-2 runs." This role gate is
// deliberately NOT flag-gated (security review SEC-01): flag-gating it like
// D-3's hotel-writes narrowing would make the Admin-only invariant depend on
// FEATURE_GD02_MATRIX staying on forever. Since M-2's backfill (a DB write)
// is not undone by flipping the flag back off, a manager whose stored
// permissions already include `users:write` would regain account-creation
// access the moment an operator disabled the flag as a rollback — the exact
// privilege-escalation-on-rollback path this hard-coded `requireRole('admin')`
// closes. `requirePermission('users:write')` below is defense-in-depth only,
// not the actual boundary.
router.post('/', requireRole('admin'), requirePermission('users:write'), ...userController.createUser);
router.get('/:user_id', requirePermission('users:read'), (req, res, next) => userController.getUser(req, res, next));
// ADR-030 D-4/D-4a: the profile-only route. 'regional_manager' added per D-5
// parity with manager — unreachable today (FEATURE_RM_ROLE is off, no live
// RM user exists), harmless to include now.
router.put('/:user_id', requireRole(['admin', 'manager', 'regional_manager']), requirePermission('users:write'), ...userController.updateUser);
// ADR-030 D-4a: the dedicated, Admin-only role-assignment endpoint. Mounted
// unconditionally — see controller.ts's updateUserRole for why this is safe
// before FEATURE_GD02_MATRIX flips (no legacy caller exists for this route).
router.put('/:user_id/role', requireRole('admin'), ...userController.updateUserRole);
router.delete('/:user_id', requireRole('admin'), (req, res, next) => userController.deleteUser(req, res, next));

export default router;

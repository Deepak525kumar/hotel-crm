import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import {
  requirePermission,
  requirePermissionFlagged,
  requireRole,
  requireRoleFlagged,
  checkHotelAccess,
} from '../../middleware/permissions.js';
import { crmController } from './controller.js';

const router = Router();

router.use(authMiddleware);

// Hotels CRUD. D-3 (ADR-030 §6 PR-5, behind FEATURE_GD02_MATRIX): hotel
// writes narrow to Admin-only. This is a no-op in practice either way —
// MANAGER has never held `hotels:write` (§1's original Problem statement:
// manager passes this role gate and is denied by the permission gate below),
// so flag-off and flag-on both already 403 a manager here today. Narrowed
// anyway for clean, documented semantics and to close the dead role-gate
// entry (D-8 hygiene).
// `regional_manager` added per ADR-030 §3 C-05 (View hotels — RM `✓ᶜ`). An RM
// holds `hotels:read` but was denied at the role gate, so it could not list the
// hotels in its own group; this also left the frontend analytics hotel-scope
// selector (populated from this route) empty for an RM. Service-side scope
// filtering narrows the result set (resolveNonAdminScopeFilter).
// `checker`/`worker` added per ADR-030 §3 C-05 (View hotels — ALL five roles
// `✓ᶜ`; every role holds `hotels:read`). Previously the LIST route admitted
// only admin/manager/regional_manager while the DETAIL route
// (`GET /hotels/:hotel_id`, checkHotelAccess()) already admitted all five —
// a checker/worker could read any individual hotel by id but not list them.
// Pinned as `C-05:checker`/`C-05:worker` in
// __tests__/support/capability-violations.ts until this fix; product
// decision (2026-08-05) was to widen the list to match the detail route
// and the ratified matrix, not narrow the matrix. `listHotels` now
// group-scopes a `worker`'s results the same way `checkHotelAccess()`
// group-scopes their per-hotel detail reads; `checker` keeps its documented
// cross-hotel bypass (PATCH-04 §4c, `resolveHotelAccess()`), matching the
// detail route exactly.
router.get('/hotels', requireRole(['admin', 'manager', 'regional_manager', 'checker', 'worker']), requirePermission('hotels:read'), ...crmController.listHotels);
router.post('/hotels', requireRoleFlagged(['admin', 'manager'], 'admin'), requirePermission('hotels:write'), ...crmController.createHotel);
router.get('/hotels/:hotel_id', checkHotelAccess(), requirePermission('hotels:read'), (req, res, next) => crmController.getHotel(req, res, next));
router.patch('/hotels/:hotel_id', checkHotelAccess(), requireRoleFlagged(['admin', 'manager'], 'admin'), requirePermission('hotels:write'), ...crmController.updateHotel);
router.delete('/hotels/:hotel_id', requireRole('admin'), (req, res, next) => crmController.deleteHotel(req, res, next));
// Admin-only, mirroring the delete it reverses. POST rather than DELETE since
// it is a state transition on an existing resource, not a removal.
router.post('/hotels/:hotel_id/reactivate', requireRole('admin'), (req, res, next) => crmController.reactivateHotel(req, res, next));

// Hotel Groups CRUD (Epic 5 PR 5.2, ADR-023). Creation/modification is
// Admin-only — REQ-CRM-010: Regional/Property Managers "manage assigned
// hotels but not create hotels or modify hotel groups." Read scoping (list
// filters, single-fetch denies out-of-scope) is enforced in-service, not via
// checkHotelAccess() middleware — the group-grain scope model doesn't fit that
// hotel-grain seam (ADR-030 PR-4, D-7).
//
// D-9 (ADR-030 §6 PR-5, behind FEATURE_GD02_MATRIX): `hotel_groups:read`/
// `hotel_groups:write` split out of `hotels:write` on the read routes below.
// Flag-gated because an existing manager's *stored* permissions won't
// contain the new tokens until M-2's backfill runs — requiring them
// unconditionally would 403 every manager immediately on deploy.
// 'regional_manager' added to the role gates now that PR-3 (mobile/frontend
// widening) has shipped — closes security review FIND-02 (previously
// tracked here as a known gap).
router.get(
  '/hotel-groups',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermissionFlagged('hotels:read', 'hotel_groups:read'),
  ...crmController.listHotelGroups
);
router.post('/hotel-groups', requireRole('admin'), requirePermissionFlagged('hotels:write', 'hotel_groups:write'), ...crmController.createHotelGroup);
router.get(
  '/hotel-groups/:hotel_group_id',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermissionFlagged('hotels:read', 'hotel_groups:read'),
  (req, res, next) => crmController.getHotelGroup(req, res, next)
);
router.patch('/hotel-groups/:hotel_group_id', requireRole('admin'), requirePermissionFlagged('hotels:write', 'hotel_groups:write'), ...crmController.updateHotelGroup);
router.delete('/hotel-groups/:hotel_group_id', requireRole('admin'), (req, res, next) => crmController.deleteHotelGroup(req, res, next));

export default router;

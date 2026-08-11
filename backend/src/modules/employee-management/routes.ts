import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { checkHotelAccess, requirePermission, requireRole } from '../../middleware/permissions.js';
import { employeeManagementController as controller } from './controller.js';

const router = Router();

router.use(authMiddleware);

// Create / bulk import. ADR-065 expands createEmployee to manager/regional_manager.
router.post('/', requireRole(['admin', 'regional_manager', 'manager']), requirePermission('employees:write'), ...controller.createEmployee);
router.post('/bulk-import', requireRole('admin'), requirePermission('employees:write'), ...controller.bulkImport);

// Review Queue (ADR-065 §6 item 7)
router.get(
  '/review-queue',
  requireRole(['admin', 'manager', 'regional_manager']),
  (req, res, next) => controller.getReviewQueue(req, res, next)
);

// By-user lookup — resolves whether a `User` already has an EmploymentRecord
// (and its current status/employee_id) without the caller needing to already
// know the employee-management-owned `employee_id`. Read-only; returns `null`
// (not 404) when no record exists yet, since "not yet onboarded" is an
// expected state for a freshly-created worker, not an error (mirrors
// `HrService.getContractStatus`'s `ContractDto | null` convention). Visibility
// enforced service-side, same as the profile/skills reads below.
router.get('/by-user/:user_id', requirePermission('employees:read'), ...controller.getByUserId);

// Profile / skills reads — visibility (self / group-scope / admin) enforced
// service-side (RULE-EMP-08 / REQ-EMP-013).
router.get('/:employee_id/profile', requirePermission('employees:read'), ...controller.getProfileHistory);
router.get(
  '/:employee_id/skills',
  requirePermission('employees:read'),
  (req, res, next) => controller.getSkills(req, res, next)
);

// Special-category access (REQ-EMP-007 / RULE-EMP-09) — Admin only.
router.get(
  '/:employee_id/special-category/:field',
  requireRole('admin'),
  requirePermission('employees:special_category:read'),
  ...controller.getSpecialCategory
);

// Subject-rights export (REQ-EMP-009) — Admin only.
router.get(
  '/:employee_id/export',
  requireRole('admin'),
  requirePermission('employees:read'),
  (req, res, next) => controller.exportEmployeeData(req, res, next)
);

// ── Lifecycle actions (REQ-EMP-002 rework, 2026-08-06) ─────────────────────
//
// Replaces the single POST /:employee_id/lifecycle-signal endpoint and the
// old Admin-only /deactivate. Two authorization tiers, deliberately split:
//
//  1. Employment-status actions (submit-for-review, approve, reject,
//     deactivate, reactivate, rehire) admit admin/manager/regional_manager at
//     the route, with scope narrowing done service-side via
//     assertLifecycleAuthority() -> isWorkerInGroupScope(). This is the same
//     split the hotel blocklist POST below already uses (route names the
//     roles, service narrows the scope) rather than trying to express a
//     group-membership predicate in a route gate, which requireRole() cannot
//     do. Supersedes OD-EMP-09's Admin-only transport boundary for these
//     actions: they are no longer internal Onboarding-driven signals but
//     first-class managerial actions on a manager's own group.
//
//  2. Account-boundary actions (delete, restore) stay requireRole('admin').
//     Both cross into User (deleted_at / is_active / token_generation), i.e.
//     they revoke or restore platform access rather than only changing
//     employment status — a strictly larger blast radius than tier 1, and one
//     no scope claim narrows. The service re-checks admin independently.
router.post(
  '/:employee_id/submit-for-review',
  requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker']),
  // Note: We omit requirePermission('employees:write') here because workers/checkers
  // only have 'employees:read'. Self-submission authorization is handled securely
  // inside assertLifecycleAuthority in the service layer.
  (req, res, next) => controller.submitForReview(req, res, next)
);
router.post(
  '/:employee_id/approve',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('employees:write'),
  ...controller.approve
);
router.post(
  '/:employee_id/assign',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('employees:write'),
  ...controller.assign
);
router.post(
  '/:employee_id/reject',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('employees:write'),
  ...controller.reject
);
router.post(
  '/:employee_id/deactivate',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('employees:write'),
  ...controller.deactivate
);
router.post(
  '/:employee_id/reactivate',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('employees:write'),
  (req, res, next) => controller.reactivate(req, res, next)
);
router.post(
  '/:employee_id/rehire',
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('employees:write'),
  (req, res, next) => controller.rehire(req, res, next)
);

// Tier 2 — account-boundary. `employees:delete` (not `employees:write`) for
// both: restore is the exact inverse of delete and reverses the same
// account-level state, so gating it on the weaker write token would let a
// holder undo a deletion they could never have performed.
router.post(
  '/:employee_id/delete',
  requireRole('admin'),
  requirePermission('employees:delete'),
  ...controller.deleteEmployee
);
router.post(
  '/:employee_id/restore',
  requireRole('admin'),
  requirePermission('employees:delete'),
  (req, res, next) => controller.restore(req, res, next)
);

// Hotel blocklist (REQ-EMP-005 / RULE-EMP-07) — hotel-scoped via
// checkHotelAccess(); service performs no additional scope check.
router.get(
  '/hotels/:hotel_id/blocklist',
  checkHotelAccess(),
  requirePermission('employees:read'),
  ...controller.getBlocklist
);
router.post(
  '/hotels/:hotel_id/blocklist',
  checkHotelAccess(),
  // ADR-030 §3 C-22 (Manage hotel blocklist) grants Regional Manager `✓ᶜ`, and
  // config/constants.ts's own note on the `employees:write` grant already said
  // "Hotel/Regional Manager may view/blocklist within scope" — the route gate
  // contradicted it. checkHotelAccess() above is group-aware for an RM
  // (resolveHotelAccess -> isHotelInScope), so scope narrowing already works;
  // only the role literal was missing. The paired GET is permission-only and
  // already admitted RM correctly, so read/write were inconsistent.
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('employees:write'),
  ...controller.setBlocklist
);
// Removal (REQ-EMP-005 / RULE-EMP-07 rework, 2026-08-06): same authorization
// shape as the POST above -- whoever can add a block can also remove one.
// :hotel_id in the path (not just :entry_id) so checkHotelAccess() can scope
// a manager/RM the same way it already does for GET/POST.
router.delete(
  '/hotels/:hotel_id/blocklist/:entry_id',
  checkHotelAccess(),
  requireRole(['admin', 'manager', 'regional_manager']),
  requirePermission('employees:write'),
  (req, res, next) => controller.removeBlocklist(req, res, next)
);

// Org chart (REQ-EMP-013 / RULE-EMP-08) — Regional Manager (their own
// group) and Admin only; group-ownership scoping enforced service-side
// (same pattern as getProfileHistory/getSkills above), not at the route.
//
// Gated on `org_chart:read` (ADR-060, ADR-030 §3 C-33), not `employees:read`:
// the latter is held by every role including MANAGER and WORKER, so it could
// never express C-33's "RM + Admin only" (CRR §1:23's ONLY). Before this, the
// restriction rested solely on the in-service role check in
// service.ts#getOrgChart — correct, but one deleted `if` away from exposing
// every group's org chart to any employees:read holder. Now both layers agree.
router.get(
  '/hotel-groups/:hotel_group_id/org-chart',
  requirePermission('org_chart:read'),
  ...controller.getOrgChart
);

export default router;

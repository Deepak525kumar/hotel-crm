import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { checkHotelAccess, requirePermission, requireRole } from '../../middleware/permissions.js';
import { employeeManagementController as controller } from './controller.js';

const router = Router();

router.use(authMiddleware);

// Create / bulk import (Admin-only — OD-EMP-08 leaves other importer roles
// OPEN; see EmployeeManagementService.createEmployee).
router.post('/', requireRole('admin'), requirePermission('employees:write'), ...controller.createEmployee);
router.post('/bulk-import', requireRole('admin'), requirePermission('employees:write'), ...controller.bulkImport);

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

// Deactivation (Admin-driven soft delete).
router.post(
  '/:employee_id/deactivate',
  requireRole('admin'),
  requirePermission('employees:delete'),
  (req, res, next) => controller.deactivate(req, res, next)
);

// Internal, Onboarding-driven lifecycle signal (OD-EMP-09: no
// service-to-service auth mechanism exists yet; Admin-gated at the transport
// boundary).
router.post(
  '/:employee_id/lifecycle-signal',
  requireRole('admin'),
  requirePermission('employees:write'),
  ...controller.lifecycleSignal
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
  requireRole(['admin', 'manager']),
  requirePermission('employees:write'),
  ...controller.setBlocklist
);

// Org chart (REQ-EMP-013 / RULE-EMP-08) — Regional Manager (their own
// group) and Admin only; group-ownership scoping enforced service-side
// (same pattern as getProfileHistory/getSkills above), not at the route.
router.get(
  '/hotel-groups/:hotel_group_id/org-chart',
  requirePermission('employees:read'),
  ...controller.getOrgChart
);

export default router;

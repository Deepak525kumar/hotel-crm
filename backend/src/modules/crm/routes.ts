import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission, requireRole, checkHotelAccess } from '../../middleware/permissions.js';
import { crmController } from './controller.js';

const router = Router();

router.use(authMiddleware);

// Hotels CRUD
router.get('/hotels', requireRole(['admin', 'manager']), requirePermission('hotels:read'), ...crmController.listHotels);
router.post('/hotels', requireRole(['admin', 'manager']), requirePermission('hotels:write'), ...crmController.createHotel);
router.get('/hotels/:hotel_id', checkHotelAccess(), requirePermission('hotels:read'), (req, res, next) => crmController.getHotel(req, res, next));
router.patch('/hotels/:hotel_id', checkHotelAccess(), requireRole(['admin', 'manager']), requirePermission('hotels:write'), ...crmController.updateHotel);
router.delete('/hotels/:hotel_id', requireRole('admin'), (req, res, next) => crmController.deleteHotel(req, res, next));

// Hotel Groups CRUD (Epic 5 PR 5.2, ADR-023). Creation/modification is
// Admin-only — REQ-CRM-010: Regional/Property Managers "manage assigned
// hotels but not create hotels or modify hotel groups." No checkHotelAccess()
// here: group-level scoping isn't wired until PR 5.4 (scope-claim issuance) /
// PR 5.5 (authz flip), per ADR-024.
router.get('/hotel-groups', requireRole(['admin', 'manager']), requirePermission('hotels:read'), ...crmController.listHotelGroups);
router.post('/hotel-groups', requireRole('admin'), requirePermission('hotels:write'), ...crmController.createHotelGroup);
router.get('/hotel-groups/:hotel_group_id', requireRole(['admin', 'manager']), requirePermission('hotels:read'), (req, res, next) => crmController.getHotelGroup(req, res, next));
router.patch('/hotel-groups/:hotel_group_id', requireRole('admin'), requirePermission('hotels:write'), ...crmController.updateHotelGroup);
router.delete('/hotel-groups/:hotel_group_id', requireRole('admin'), (req, res, next) => crmController.deleteHotelGroup(req, res, next));

export default router;

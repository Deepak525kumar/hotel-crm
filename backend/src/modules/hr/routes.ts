import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { hrController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// Contracts
router.get('/contracts', (req, res, next) => hrController.listContracts(req, res, next));
router.post('/contracts', requirePermission('hr:write'), (req, res, next) =>
  hrController.createContract(req, res, next)
);

// Payroll
router.get('/payroll', requirePermission('hr:read'), (req, res, next) =>
  hrController.listPayroll(req, res, next)
);
router.post('/payroll', requirePermission('hr:write'), (req, res, next) =>
  hrController.createPayroll(req, res, next)
);

// Documents
router.post('/workers/:worker_id/documents', requirePermission('hr:write'), (req, res, next) =>
  hrController.uploadDocument(req, res, next)
);

export default router;

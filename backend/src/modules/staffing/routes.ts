import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { staffingController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// Work requests
router.post('/work-requests', requirePermission('staffing:write'), (req, res, next) =>
  staffingController.createWorkRequest(req, res, next)
);

// Available workers
router.get('/available-workers', requirePermission('staffing:read'), (req, res, next) =>
  staffingController.getAvailableWorkers(req, res, next)
);

// Worker assignments
router.post('/work-requests/:work_request_id/assign-workers', requirePermission('staffing:write'), (req, res, next) =>
  staffingController.assignWorkers(req, res, next)
);
router.post('/assignments/:assignment_id/start', (req, res, next) =>
  staffingController.startAssignment(req, res, next)
);
router.post('/assignments/:assignment_id/complete', (req, res, next) =>
  staffingController.completeAssignment(req, res, next)
);

export default router;

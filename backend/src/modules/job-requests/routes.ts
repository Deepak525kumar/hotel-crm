import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import {
  createWorkRequest,
  getWorkRequest,
  listWorkRequests,
  updateWorkRequest,
} from './controller.js';

const router = Router();

router.use(authMiddleware);

// RBAC per API_SPEC_V1_PATCH_V2 §PATCH-07g.
// Create / mutate: ADMIN, MANAGER. Read: all authenticated roles
// (results are scoped to roster membership for non-management in the service).
router.post('/', requireRole(['admin', 'manager']), createWorkRequest);
router.get('/', listWorkRequests);
router.get('/:id', getWorkRequest);
router.patch('/:id', requireRole(['admin', 'manager']), updateWorkRequest);

export default router;

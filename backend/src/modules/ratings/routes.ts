import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import { createRating, listRatings, getRating } from './controller.js';

const router = Router();

router.use(authMiddleware);

// RBAC per API_SPEC_V1_PATCH_V2 §PATCH-07:
// Create: admin/manager. Read: all authenticated (service scopes workers to own).
router.post('/', requireRole(['admin', 'manager']), createRating);
router.get('/', listRatings);
router.get('/:id', getRating);

export default router;

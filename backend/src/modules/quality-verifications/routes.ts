import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import { createVerification, listVerifications, getVerification } from './controller.js';

const router = Router();

router.use(authMiddleware);

// RBAC per API_SPEC_V1_PATCH_V2 §PATCH-07:
// Create: checker/manager/admin. Read: all authenticated (service scopes workers to own).
router.post('/', requireRole(['admin', 'manager', 'checker']), createVerification);
router.get('/', listVerifications);
router.get('/:id', getVerification);

export default router;

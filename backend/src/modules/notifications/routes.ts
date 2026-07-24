import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import { notificationController } from './controller.js';
import {
  discardDeadLetter,
  getOutboxMetrics,
  listDeadLetters,
  requeueDeadLetter,
} from './outbox-admin-controller.js';

const router = Router();
router.use(authMiddleware);

// Operator surface over state-outbox (Epic 7 PR 7.6, ADR-029 §9). Admin-only:
// these expose internal delivery state and mutate the queue, so they follow the
// same `requireRole('admin')` gate as the other destructive/administrative
// routes (crm hotel-group delete, users delete). Registered before the
// `/:notification_id/read` route so `outbox` is never parsed as an id.
router.get('/outbox/metrics', requireRole('admin'), getOutboxMetrics);
router.get('/outbox/dead-letters', requireRole('admin'), listDeadLetters);
router.post('/outbox/dead-letters/:outbox_id/requeue', requireRole('admin'), requeueDeadLetter);
router.delete('/outbox/dead-letters/:outbox_id', requireRole('admin'), discardDeadLetter);

router.get('/', (req, res, next) => notificationController.getNotifications(req, res, next));
router.post('/:notification_id/read', (req, res, next) =>
  notificationController.markAsRead(req, res, next)
);
router.post('/push-tokens', (req, res, next) => notificationController.registerPushToken(req, res, next));

export default router;

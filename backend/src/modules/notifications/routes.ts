import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { notificationController } from './controller.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res, next) => notificationController.getNotifications(req, res, next));
router.post('/:notification_id/read', (req, res, next) =>
  notificationController.markAsRead(req, res, next)
);
router.post('/push-tokens', (req, res, next) => notificationController.registerPushToken(req, res, next));

export default router;

import { Router } from 'express';
import { authController } from './controller.js';
import { authMiddleware } from '../../middleware/auth.js';

const router = Router();

router.post('/signup', ...authController.signup);
router.post('/login', ...authController.login);
router.post('/refresh', ...authController.refreshToken);

router.post('/logout', authMiddleware, (req, res, next) => authController.logout(req, res, next));
router.get('/me', authMiddleware, (req, res, next) => authController.getCurrentUser(req, res, next));
router.put('/profile', authMiddleware, ...authController.updateProfile);

export default router;

import { Router } from 'express';
import { authController } from './controller.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permissions.js';
import { validateBody } from '../../middleware/validation.js';
import {
  SignupSchema,
  LoginSchema,
  RefreshTokenSchema,
  UpdateProfileSchema,
} from './validation.js';

const router = Router();

// Public endpoints
router.post(
  '/signup',
  validateBody(SignupSchema),
  requireRole('admin'),
  (req, res, next) => authController.signup(req, res, next)
);

router.post(
  '/login',
  validateBody(LoginSchema),
  (req, res, next) => authController.login(req, res, next)
);

router.post(
  '/refresh',
  validateBody(RefreshTokenSchema),
  (req, res, next) => authController.refreshToken(req, res, next)
);

// Protected endpoints
router.post(
  '/logout',
  authMiddleware,
  (req, res, next) => authController.logout(req, res, next)
);

router.get(
  '/me',
  authMiddleware,
  (req, res, next) => authController.getCurrentUser(req, res, next)
);

router.put(
  '/profile',
  authMiddleware,
  validateBody(UpdateProfileSchema),
  (req, res, next) => authController.updateProfile(req, res, next)
);

router.delete(
  '/account',
  authMiddleware,
  (req, res, next) => authController.deleteAccount(req, res, next)
);

router.get(
  '/account/export',
  authMiddleware,
  (req, res, next) => authController.exportUserData(req, res, next)
);

export default router;

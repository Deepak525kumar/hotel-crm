import { Router } from 'express';
import { authController } from './controller.js';
import { authMiddleware } from '../../middleware/auth.js';
import { loginRateLimit, passwordResetRateLimit } from '../../middleware/rateLimit.js';

const router = Router();

// Rate limiters called ONCE here, at route-registration time (this module
// is loaded once, like every Express router) -- each call below reuses the
// SAME middleware closure, and with it the same request-count store, across
// every request that hits the route. Calling loginRateLimit()/
// passwordResetRateLimit() again per-request (e.g. inline in a request
// handler) would silently create a fresh, always-empty counter on every
// call and make the limiter a no-op; see middleware/rateLimit.ts's own
// comment for why this exists and what it does and does not defend against.
//
// Placed first in each chain, before body validation -- reject abusive
// traffic as cheaply as possible, without spending Zod/bcrypt work on a
// request already over its budget.
router.post('/signup', ...authController.signup);
router.post('/login', loginRateLimit(), ...authController.login);
router.post('/refresh', ...authController.refreshToken);

// Both password-reset endpoints share ONE limiter instance -- called once,
// reused on both routes below -- not one call per route. Two separate calls
// would create two independent counters and silently double the real
// budget (10 + 10 attempts instead of 10 total), defeating the point.
// confirm is the more sensitive of the two endpoints (a correctly-guessed
// token there is account takeover), and the repo's own dormant Nginx config
// already grouped them under one shared zone for the identical reason
// ("login, password-reset/confirm").
const passwordResetLimiter = passwordResetRateLimit();
router.post('/password-reset', passwordResetLimiter, ...authController.requestPasswordReset);
router.post('/password-reset/confirm', passwordResetLimiter, ...authController.confirmPasswordReset);
router.post('/logout', authMiddleware, (req, res, next) => authController.logout(req, res, next));
router.get('/me', authMiddleware, (req, res, next) => authController.getCurrentUser(req, res, next));
router.put('/profile', authMiddleware, ...authController.updateProfile);

export default router;

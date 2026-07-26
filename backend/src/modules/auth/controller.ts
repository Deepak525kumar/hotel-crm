import { Request, Response, NextFunction } from 'express';
import { authService } from './service.js';
import { SignupSchema, LoginSchema, RefreshTokenSchema, UpdateProfileSchema, PasswordResetRequestSchema, PasswordResetConfirmSchema } from './validation.js';
import { validateBody } from '../../middleware/validation.js';
import { UnauthorizedError } from '../../lib/errors.js';

export class AuthController {
  signup = [
    validateBody(SignupSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await authService.signup(req.body, req.ip);
        res.status(201).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  login = [
    validateBody(LoginSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await authService.login(req.body, req.ip);
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  refreshToken = [
    validateBody(RefreshTokenSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await authService.refreshToken(req.body);
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const refreshToken = req.body?.refresh_token as string | undefined;
      await authService.logout(req.auth.userId, refreshToken);
      res.status(200).json({
        status: 'success',
        data: { message: 'Logged out successfully' },
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async getCurrentUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const user = await authService.getCurrentUser(req.auth.userId);
      res.status(200).json({
        status: 'success',
        data: user,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  requestPasswordReset = [
    validateBody(PasswordResetRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await authService.requestPasswordReset(req.body, req.ip);
        res.status(200).json({
          status: 'success',
          data: { message: 'If that email exists, a password reset has been initiated' },
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  confirmPasswordReset = [
    validateBody(PasswordResetConfirmSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await authService.confirmPasswordReset(req.body, req.ip);
        res.status(200).json({
          status: 'success',
          data: { message: 'Password has been reset successfully' },
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  // ADR-031 D-4 (PR-4): Admin-only incident-response endpoint — "log out
  // everywhere" for a specific user, distinct from that user's own `logout`.
  async revokeAllSessions(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      await authService.revokeAllSessions(req.params['user_id']!, req.auth.userId, req.auth.role, req.ip);
      res.status(200).json({
        status: 'success',
        data: { message: 'All sessions revoked' },
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  updateProfile = [
    validateBody(UpdateProfileSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await authService.updateProfile(req.auth.userId, req.body, req.ip);
        res.status(200).json({
          status: 'success',
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];
}

export const authController = new AuthController();

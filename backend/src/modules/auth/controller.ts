import { Request, Response, NextFunction } from 'express';
import { authService } from './service.js';
import { UnauthorizedError } from '../../lib/errors.js';
import {
  SignupRequest,
  LoginRequest,
  RefreshTokenRequest,
  UpdateProfileRequest,
} from './validation.js';

export class AuthController {
  async signup(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as SignupRequest;
      const result = await authService.signup(data);
      res.status(201).json({
        status: 'success',
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as LoginRequest;
      const result = await authService.login(data);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as RefreshTokenRequest;
      const result = await authService.refreshToken(data);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) {
        throw new UnauthorizedError('Authentication required');
      }

      await authService.logout(req.auth.userId);

      res.status(200).json({
        status: 'success',
        data: { message: 'Logged out successfully' },
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getCurrentUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) {
        throw new UnauthorizedError('Authentication required');
      }

      const user = await authService.getCurrentUser(req.auth.userId);

      res.status(200).json({
        status: 'success',
        data: user,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) {
        throw new UnauthorizedError('Authentication required');
      }

      const data = req.body as UpdateProfileRequest;
      const result = await authService.updateProfile(req.auth.userId, data);

      res.status(200).json({
        status: 'success',
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteAccount(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) {
        throw new UnauthorizedError('Authentication required');
      }

      const result = await authService.deleteAccount(req.auth.userId);

      res.status(200).json({
        status: 'success',
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async exportUserData(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) {
        throw new UnauthorizedError('Authentication required');
      }

      const result = await authService.exportUserData(req.auth.userId);

      res.status(200).json({
        status: 'success',
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();

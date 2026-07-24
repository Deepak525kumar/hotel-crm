import { Request, Response, NextFunction } from 'express';
import { notificationService } from './service.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { RegisterPushTokenSchema } from './push-token-types.js';

export class NotificationController {
  async getNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const result = await notificationService.getNotifications(req.auth.userId);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const result = await notificationService.markAsRead(req.params.notification_id, req.auth.userId);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
  async registerPushToken(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = RegisterPushTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          'Invalid request body',
          parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }))
        );
      }
      const result = await notificationService.registerPushToken(
        req.auth.userId,
        parsed.data.token,
        parsed.data.platform,
        parsed.data.app
      );
      res.status(201).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const notificationController = new NotificationController();

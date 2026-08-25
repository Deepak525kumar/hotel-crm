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
        // `user_id` is re-attached from `req.auth`, never from the store: the
        // response shape predates the Firestore-backed store (whose
        // StoredPushToken carries no user_id — the user is the collection key,
        // not a document field), and existing clients must not see the field
        // disappear. Sourcing it from req.auth also keeps it impossible for a
        // store to report an owner other than the authenticated caller.
        data: { ...result, user_id: req.auth.userId },
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const notificationController = new NotificationController();

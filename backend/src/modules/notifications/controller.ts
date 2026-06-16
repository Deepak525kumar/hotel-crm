import { Request, Response, NextFunction } from 'express';
import { notificationService } from './service.js';

export class NotificationController {
  async getNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new Error('Not authenticated');
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
      if (!req.auth) throw new Error('Not authenticated');
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
}

export const notificationController = new NotificationController();

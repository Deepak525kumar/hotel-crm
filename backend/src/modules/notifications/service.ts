import { BaseService } from '../../lib/base-service.js';

export class NotificationService extends BaseService {
  async sendNotification(_userId: string, _payload: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async getNotifications(_userId: string) {
    throw new Error('Not implemented');
  }

  async markAsRead(_notificationId: string) {
    throw new Error('Not implemented');
  }

  async sendEmail(_email: string, _subject: string, _body: string) {
    throw new Error('Not implemented');
  }

  async sendPushNotification(_userId: string, _title: string, _body: string) {
    throw new Error('Not implemented');
  }
}

export const notificationService = new NotificationService();

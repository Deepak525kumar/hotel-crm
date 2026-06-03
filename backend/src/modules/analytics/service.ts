import { BaseService } from '../../lib/base-service.js';

export class AnalyticsService extends BaseService {
  async getLeaderboard(_hotelId?: string) {
    throw new Error('Not implemented');
  }

  async getDashboardStats(_hotelId: string) {
    throw new Error('Not implemented');
  }

  async getHotelSummary(_hotelId: string) {
    throw new Error('Not implemented');
  }
}

export const analyticsService = new AnalyticsService();

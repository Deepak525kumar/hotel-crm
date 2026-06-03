import { BaseService } from '../../lib/base-service.js';

export class QualityService extends BaseService {
  async createVerification(_data: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async createRating(_data: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async getLeaderboard(_hotelId: string) {
    throw new Error('Not implemented');
  }
}

export const qualityService = new QualityService();

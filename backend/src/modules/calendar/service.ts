import { BaseService } from '../../lib/base-service.js';

export class CalendarService extends BaseService {
  async getDailyOperations(_hotelId: string, _date: string) {
    throw new Error('Not implemented');
  }

  async createDailyOperation(_hotelId: string, _data: Record<string, unknown>) {
    throw new Error('Not implemented');
  }
}

export const calendarService = new CalendarService();

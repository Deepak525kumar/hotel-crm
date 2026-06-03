import { BaseService } from '../../lib/base-service.js';

/**
 * CRM Service - Hotels, Rooms, Tasks
 *
 * IMPORTANT: Implementation deferred to later phase
 * This is a skeleton for the modular monolith structure
 */
export class CrmService extends BaseService {
  async createHotel(_data: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async getHotel(_hotelId: string) {
    throw new Error('Not implemented');
  }

  async listHotels(_filters?: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async createRoom(_hotelId: string, _data: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async createTask(_hotelId: string, _data: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async completeTask(_taskId: string, _userId: string) {
    throw new Error('Not implemented');
  }

  async uploadTaskPhoto(_taskId: string, _file: Buffer, _metadata?: Record<string, unknown>) {
    throw new Error('Not implemented');
  }
}

export const crmService = new CrmService();

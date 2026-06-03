import { BaseService } from '../../lib/base-service.js';

export class StaffingService extends BaseService {
  async createWorkRequest(_data: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async assignWorkers(_workRequestId: string, _data: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async getAvailableWorkers(_hotelId: string, _date: string) {
    throw new Error('Not implemented');
  }

  async startAssignment(_assignmentId: string) {
    throw new Error('Not implemented');
  }

  async completeAssignment(_assignmentId: string) {
    throw new Error('Not implemented');
  }
}

export const staffingService = new StaffingService();

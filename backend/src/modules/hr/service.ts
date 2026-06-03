import { BaseService } from '../../lib/base-service.js';

export class HrService extends BaseService {
  async createContract(_data: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async listContracts(_filters?: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async createPayroll(_data: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async listPayroll(_filters?: Record<string, unknown>) {
    throw new Error('Not implemented');
  }

  async uploadDocument(_workerId: string, _file: Buffer, _metadata?: Record<string, unknown>) {
    throw new Error('Not implemented');
  }
}

export const hrService = new HrService();

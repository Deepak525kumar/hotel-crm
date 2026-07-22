import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ADR-028 (2026-07-22, OQ-ANALYTICS-03): manager-entered "rooms completed" count,
// 1-to-1 with the worker's full-day WorkerAssignment. Service-layer coverage for
// AssignmentService.logRoomsCompleted — not-found, scope-authz (mirrors quality's
// createRating/createVerification, Epic 5 PR 5.5), duplicate-entry conflict, and
// the happy path.

const mockWorkerAssignment = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockRoomsCompletedEntry = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockAuditLog = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  workerAssignment: mockWorkerAssignment,
  roomsCompletedEntry: mockRoomsCompletedEntry,
  auditLog: mockAuditLog,
  hotel: mockHotel,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));
jest.mock('../config/feature-flags.js', () => ({
  isScopeAuthzEnabled: () => true,
}));
jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

import { Prisma } from '@prisma/client';
import { AssignmentService } from '../modules/assignments/service.js';

describe('AssignmentService.logRoomsCompleted (ADR-028, OQ-ANALYTICS-03)', () => {
  let service: AssignmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AssignmentService();
  });

  it('throws NotFoundError for an unknown assignment', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.logRoomsCompleted('a1', { rooms_completed: 5 }, { userId: 'mgr1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('admin may log rooms completed for any hotel', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', hotel_id: 'h1', worker_id: 'w1' });
    mockRoomsCompletedEntry.create.mockResolvedValue({
      id: 'rce1',
      assignment_id: 'a1',
      hotel_id: 'h1',
      worker_id: 'w1',
      entered_by_id: 'adm1',
      rooms_completed: 12,
      notes: null,
      created_at: new Date('2026-07-22T00:00:00Z'),
      updated_at: new Date('2026-07-22T00:00:00Z'),
    });
    const dto = await service.logRoomsCompleted(
      'a1',
      { rooms_completed: 12 },
      { userId: 'adm1', role: 'admin' }
    );
    expect(dto.rooms_completed).toBe(12);
    expect(dto.assignment_id).toBe('a1');
    expect(mockRoomsCompletedEntry.create.mock.calls[0][0].data).toMatchObject({
      assignment_id: 'a1',
      hotel_id: 'h1',
      worker_id: 'w1',
      entered_by_id: 'adm1',
      rooms_completed: 12,
    });
  });

  it('allows a manager to log rooms completed for an in-scope hotel', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', hotel_id: 'h1', worker_id: 'w1' });
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockRoomsCompletedEntry.create.mockResolvedValue({
      id: 'rce1',
      assignment_id: 'a1',
      hotel_id: 'h1',
      worker_id: 'w1',
      entered_by_id: 'mgr1',
      rooms_completed: 8,
      notes: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const dto = await service.logRoomsCompleted(
      'a1',
      { rooms_completed: 8 },
      { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } }
    );
    expect(dto.rooms_completed).toBe(8);
  });

  it('denies a manager logging rooms completed for an out-of-scope hotel', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', hotel_id: 'h2', worker_id: 'w1' });
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g2' });
    await expect(
      service.logRoomsCompleted(
        'a1',
        { rooms_completed: 8 },
        { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } }
      )
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(mockRoomsCompletedEntry.create).not.toHaveBeenCalled();
  });

  it('translates a P2002 duplicate-entry race into ConflictError', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', hotel_id: 'h1', worker_id: 'w1' });
    mockRoomsCompletedEntry.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );
    await expect(
      service.logRoomsCompleted('a1', { rooms_completed: 5 }, { userId: 'adm1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('writes an audit log entry on success', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', hotel_id: 'h1', worker_id: 'w1' });
    mockRoomsCompletedEntry.create.mockResolvedValue({
      id: 'rce1',
      assignment_id: 'a1',
      hotel_id: 'h1',
      worker_id: 'w1',
      entered_by_id: 'adm1',
      rooms_completed: 3,
      notes: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await service.logRoomsCompleted('a1', { rooms_completed: 3 }, { userId: 'adm1', role: 'admin' });
    expect(mockAuditLog.create).toHaveBeenCalled();
    const auditData = mockAuditLog.create.mock.calls[0][0].data;
    expect(auditData.action).toBe('LOG_ROOMS_COMPLETED');
    expect(auditData.resource_type).toBe('ROOMS_COMPLETED_ENTRY');
  });
});

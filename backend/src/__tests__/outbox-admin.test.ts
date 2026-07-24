import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Epic 7 PR 7.6 (ADR-029 §9): operator observability + dead-letter operability.
 *
 * Drives the real notifications router end-to-end via supertest so the actual
 * `requireRole('admin')` gate is exercised, with only authMiddleware replaced by
 * a test-context injector (mirrors attendance-scope-authz.test.ts).
 */

let testAuth: { userId: string; role: string; permissions: string[]; scope: unknown } | null = null;

const mockOutboxEvent = {
  groupBy: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  updateMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  deleteMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockAuditCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

const dbMock = {
  outboxEvent: mockOutboxEvent,
  auditLog: { create: mockAuditCreate },
  $queryRaw: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => dbMock }));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ JWT_SECRET: 'test-secret-key-minimum-32-characters-long', NODE_ENV: 'test' }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, res: Response, next: NextFunction) => {
    if (!testAuth) {
      res.status(401).json({ error: 'UnauthorizedError', message: 'Not authenticated' });
      return;
    }
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import notificationsRouter from '../modules/notifications/routes.js';
import { OutboxAdminService } from '../modules/notifications/outbox-admin-service.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/notifications', notificationsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

const deadLetterRow = {
  id: 'row1',
  event_id: 'evt-abc',
  correlation_id: 'corr-1',
  event_type: 'NOTIFICATION_CREATED',
  transport: 'PUSH',
  source_module: 'ATTENDANCE',
  status: 'DEAD_LETTER',
  attempts: 4,
  last_error: 'APNs 503',
};

const admin = { userId: 'admin1', role: 'admin', permissions: [], scope: null };

beforeEach(() => {
  jest.clearAllMocks();
  testAuth = admin;
});

describe('Outbox operator endpoints — authorization (Epic 7 PR 7.6)', () => {
  const routes: Array<[string, string]> = [
    ['get', '/notifications/outbox/metrics'],
    ['get', '/notifications/outbox/dead-letters'],
    ['post', '/notifications/outbox/dead-letters/row1/requeue'],
    ['delete', '/notifications/outbox/dead-letters/row1'],
  ];

  it.each(routes)('%s %s returns 403 for a non-admin (manager)', async (method, path) => {
    testAuth = { userId: 'mgr1', role: 'manager', permissions: [], scope: null };
    const res = await (request(makeApp()) as any)[method](path);
    expect(res.status).toBe(403);
  });

  it.each(routes)('%s %s returns 403 for a worker', async (method, path) => {
    testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    const res = await (request(makeApp()) as any)[method](path);
    expect(res.status).toBe(403);
  });

  it.each(routes)('%s %s returns 401 when unauthenticated', async (method, path) => {
    testAuth = null;
    const res = await (request(makeApp()) as any)[method](path);
    expect(res.status).toBe(401);
  });

  it('never touches the outbox when authorization fails', async () => {
    testAuth = { userId: 'mgr1', role: 'manager', permissions: [], scope: null };
    await request(makeApp()).post('/notifications/outbox/dead-letters/row1/requeue');
    expect(mockOutboxEvent.findUnique).not.toHaveBeenCalled();
    expect(mockOutboxEvent.updateMany).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });
});

describe('GET /notifications/outbox/metrics (ADR-029 §9 minimum surface)', () => {
  it('returns status counts, backlog, oldest-pending age, and delivery latency', async () => {
    mockOutboxEvent.groupBy.mockResolvedValue([
      { status: 'DELIVERED', _count: { _all: 10 } },
      { status: 'DEAD_LETTER', _count: { _all: 2 } },
    ]);
    mockOutboxEvent.aggregate.mockResolvedValue({
      _count: { _all: 5 },
      _min: { created_at: new Date(Date.now() - 60_000) },
    });
    dbMock.$queryRaw.mockResolvedValue([{ avg_ms: 250.5, sample_size: BigInt(10) }]);

    const res = await request(makeApp()).get('/notifications/outbox/metrics');

    expect(res.status).toBe(200);
    expect(res.body.data.counts).toMatchObject({ DELIVERED: 10, DEAD_LETTER: 2, PENDING: 0 });
    expect(res.body.data.backlog_count).toBe(5);
    expect(res.body.data.oldest_pending_age_ms).toBeGreaterThanOrEqual(60_000);
    expect(res.body.data.delivery_latency_ms).toEqual({ average: 250.5, sample_size: 10 });
  });
});

describe('GET /notifications/outbox/dead-letters', () => {
  it('returns a paginated dead-letter list carrying each event retry_count', async () => {
    mockOutboxEvent.findMany.mockResolvedValue([deadLetterRow]);
    mockOutboxEvent.count.mockResolvedValue(1);

    const res = await request(makeApp()).get('/notifications/outbox/dead-letters?page=1&per_page=20');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ event_id: 'evt-abc', attempts: 4, last_error: 'APNs 503' });
    expect(res.body.pagination).toMatchObject({ page: 1, per_page: 20, total: 1, total_pages: 1 });
  });

  it('rejects an out-of-range per_page', async () => {
    const res = await request(makeApp()).get('/notifications/outbox/dead-letters?per_page=500');
    expect(res.status).toBe(422);
    expect(mockOutboxEvent.findMany).not.toHaveBeenCalled();
  });
});

describe('POST .../:id/requeue', () => {
  it('requeues and writes exactly one audit row for the operator action', async () => {
    mockOutboxEvent.findUnique.mockResolvedValue(deadLetterRow);
    mockOutboxEvent.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(makeApp()).post('/notifications/outbox/dead-letters/row1/requeue');

    expect(res.status).toBe(200);
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    const auditData = mockAuditCreate.mock.calls[0][0].data;
    expect(auditData.action).toBe('outbox.requeue');
    expect(auditData.resource_type).toBe('OUTBOX_EVENT');
    // resource_id is the event_id, not the table row id — it survives a discard.
    expect(auditData.resource_id).toBe('evt-abc');
    expect(auditData.actor_id).toBe('admin1');
    expect(auditData.actor_role).toBe('ADMIN');
    expect(auditData.details).toMatchObject({ transport: 'PUSH', attempts: 4, last_error: 'APNs 503' });
  });

  it('returns 404 and writes no audit row when the event is not dead-lettered', async () => {
    mockOutboxEvent.findUnique.mockResolvedValue({ ...deadLetterRow, status: 'PENDING' });

    const res = await request(makeApp()).post('/notifications/outbox/dead-letters/row1/requeue');

    expect(res.status).toBe(404);
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });
});

describe('DELETE .../:id (discard)', () => {
  it('discards and writes exactly one audit row capturing what was dropped', async () => {
    mockOutboxEvent.findUnique.mockResolvedValue(deadLetterRow);
    mockOutboxEvent.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(makeApp()).delete('/notifications/outbox/dead-letters/row1');

    expect(res.status).toBe(200);
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    const auditData = mockAuditCreate.mock.calls[0][0].data;
    expect(auditData.action).toBe('outbox.discard');
    expect(auditData.resource_id).toBe('evt-abc');
    // The row is gone after this — the audit details are its only remaining record.
    expect(auditData.details).toMatchObject({
      outbox_row_id: 'row1',
      correlation_id: 'corr-1',
      transport: 'PUSH',
      source_module: 'ATTENDANCE',
      attempts: 4,
      last_error: 'APNs 503',
    });
  });

  it('returns 404 and deletes nothing when the event does not exist', async () => {
    mockOutboxEvent.findUnique.mockResolvedValue(null);

    const res = await request(makeApp()).delete('/notifications/outbox/dead-letters/row1');

    expect(res.status).toBe(404);
    expect(mockOutboxEvent.deleteMany).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });
});

describe('OutboxAdminService audit policy (Epic 7 PR 7.6)', () => {
  it('does not audit DEAD_LETTER transitions — only operator actions', async () => {
    // The service exposes no transition method at all: dead-lettering is the
    // Platform Worker's concern (OutboxRepository.recordFailure), and it writes
    // no AuditLog. Operational state lives in the OutboxEvent row itself.
    const service = new OutboxAdminService();
    const methods = Object.getOwnPropertyNames(OutboxAdminService.prototype);
    expect(methods).toEqual(
      expect.arrayContaining(['getMetrics', 'listDeadLetters', 'requeue', 'discard'])
    );
    expect(methods).not.toContain('recordFailure');
    expect(methods).not.toContain('markDeadLetter');
    expect(service).toBeInstanceOf(OutboxAdminService);
  });
});

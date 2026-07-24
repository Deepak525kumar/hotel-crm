import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Epic 7 PR 7.5 (ADR-029 §4): POST /notifications/push-tokens registration
 * endpoint. Drives the real notifications router end-to-end via supertest,
 * with authMiddleware replaced by a test-context injector (mirrors
 * attendance-scope-authz.test.ts).
 */

let testAuth: { userId: string; role: string; permissions: string[]; scope: unknown } | null = null;

const mockUpsert = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const dbMock = { pushToken: { upsert: mockUpsert } };

jest.mock('../lib/db.js', () => ({ getPrisma: () => dbMock }));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ JWT_SECRET: 'test-secret-key-minimum-32-characters-long', NODE_ENV: 'test' }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
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

describe('POST /notifications/push-tokens (Epic 7 PR 7.5, ADR-029 §4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    testAuth = { userId: 'user1', role: 'worker', permissions: [], scope: null };
  });

  it('registers a valid token and returns 201', async () => {
    mockUpsert.mockResolvedValue({
      id: 'pt1',
      token: 'device-token-abc',
      platform: 'IOS',
      user_id: 'user1',
    });

    const res = await request(makeApp())
      .post('/notifications/push-tokens')
      .send({ token: 'device-token-abc', platform: 'IOS' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ token: 'device-token-abc', platform: 'IOS', user_id: 'user1' });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { token: 'device-token-abc' },
      update: { user_id: 'user1', platform: 'IOS' },
      create: { token: 'device-token-abc', platform: 'IOS', user_id: 'user1' },
    });
  });

  it('re-registering an existing token under a different user reassigns ownership (security-correctness)', async () => {
    testAuth = { userId: 'user2', role: 'worker', permissions: [], scope: null };
    mockUpsert.mockResolvedValue({
      id: 'pt1',
      token: 'device-token-abc',
      platform: 'IOS',
      user_id: 'user2',
    });

    const res = await request(makeApp())
      .post('/notifications/push-tokens')
      .send({ token: 'device-token-abc', platform: 'IOS' });

    expect(res.status).toBe(201);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: 'device-token-abc' },
        update: { user_id: 'user2', platform: 'IOS' },
      })
    );
    expect(res.body.data.user_id).toBe('user2');
  });

  it('returns 422 for a missing token', async () => {
    const res = await request(makeApp()).post('/notifications/push-tokens').send({ platform: 'IOS' });
    expect(res.status).toBe(422);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 422 for an invalid platform', async () => {
    const res = await request(makeApp())
      .post('/notifications/push-tokens')
      .send({ token: 'device-token-abc', platform: 'WINDOWS_PHONE' });
    expect(res.status).toBe(422);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    testAuth = null;
    const res = await request(makeApp())
      .post('/notifications/push-tokens')
      .send({ token: 'device-token-abc', platform: 'IOS' });
    expect(res.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

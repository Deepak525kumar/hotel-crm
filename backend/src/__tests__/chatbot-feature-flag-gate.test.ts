import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * "Both-off = current behavior" (ADR-024 D3), the posture every cutover flag
 * in this repo follows: while FEATURE_CHATBOT is off, `/chatbot` must fall
 * through to the 404 handler exactly as if the module did not exist.
 *
 * This is the rollback guarantee. If it fails, the kill switch does not kill.
 */

let chatbotEnabled = false;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'test' }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

jest.mock('../config/feature-flags.js', () => ({
  isChatbotEnabled: () => chatbotEnabled,
  isEmploymentRecordEnabled: () => false,
  isJobDispatchPhase2Enabled: () => false,
  isGD02MatrixEnabled: () => false,
  isConsentGateEnabled: () => false,
  getConsentGateRoles: () => [],
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    workerAssignment: { findMany: async () => [], count: async () => 0 },
    roomsCompletedEntry: { findMany: async () => [] },
    user: { findMany: async () => [] },
    auditLog: { create: async () => ({}) },
  }),
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = { userId: 'w1', role: 'worker', permissions: ['staffing:read'], scope: null };
    (req as any).requestId = 'req_test';
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import chatbotRoutes from '../modules/chatbot/routes.js';
import { isChatbotEnabled } from '../config/feature-flags.js';

// Mirrors the mount in routes/v1/index.ts exactly.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/chatbot', (req, res, next) => {
    if (!isChatbotEnabled()) {
      next();
      return;
    }
    chatbotRoutes(req, res, next);
  });
  app.use((_req, res) => res.status(404).json({ error: 'NotFound' }));
  return app;
}

beforeEach(() => {
  chatbotEnabled = false;
});

describe('FEATURE_CHATBOT gate', () => {
  it('404s every chatbot route while the flag is off', async () => {
    const app = makeApp();
    expect((await request(app).get('/chatbot/tools')).status).toBe(404);
    expect(
      (await request(app).post('/chatbot/tools/invoke').send({ tool: 'assignments.list_mine', args: {} }))
        .status
    ).toBe(404);
  });

  it('serves the routes once the flag is on', async () => {
    chatbotEnabled = true;
    const res = await request(makeApp()).get('/chatbot/tools');
    expect(res.status).toBe(200);
  });

  it('defaults to off', async () => {
    // The default lives in config/env.ts as strictBooleanFlag(false); this
    // asserts the mount treats "not enabled" as "not mounted".
    const res = await request(makeApp()).get('/chatbot/tools');
    expect(res.status).toBe(404);
  });
});

import { describe, it, expect, jest, beforeAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';

/**
 * IP-keyed rate limiting on /auth/login and /auth/password-reset*
 * (security-audit item #6, 2026-09-03 -- see middleware/rateLimit.ts's own
 * header comment for the full "why", and why this is complementary to
 * ADR-070's per-account throttle, not a duplicate of it).
 *
 * A minimal app is mounted here -- just the two limiters over stub handlers
 * -- rather than the real auth router, so this suite tests exactly one
 * thing (the limiter's own counting/response behavior) without needing to
 * mock Prisma/bcrypt/JWT for routes that aren't what's under test.
 */

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    AUTH_RATE_LIMIT_WINDOW_MS: 60_000,
    AUTH_LOGIN_RATE_LIMIT_MAX: 3,
    AUTH_PASSWORD_RESET_RATE_LIMIT_MAX: 2,
  }),
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

// Deliberately AFTER the mocks above, matching this repo's own convention
// (jest.mock calls are hoisted, but the import must still come after them
// in source order for readability/consistency with the rest of this suite).
import { loginRateLimit, passwordResetRateLimit } from '../middleware/rateLimit.js';
import { errorHandler } from '../middleware/errorHandler.js';

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.post('/auth/login', loginRateLimit(), (_req, res) => res.status(200).json({ ok: true }));

  // ONE limiter instance shared across both routes, exactly as
  // auth/routes.ts itself does -- the behavior this suite most needs to pin
  // is that the two endpoints share a combined budget, not one each.
  const resetLimiter = passwordResetRateLimit();
  app.post('/auth/password-reset', resetLimiter, (_req, res) => res.status(200).json({ ok: true }));
  app.post('/auth/password-reset/confirm', resetLimiter, (_req, res) => res.status(200).json({ ok: true }));

  app.use(errorHandler);
});

describe('loginRateLimit', () => {
  it('allows requests up to the configured max', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/auth/login').send({});
      expect(res.status).toBe(200);
    }
  });

  it('rejects the request past the max with the app\'s own error envelope and Retry-After', async () => {
    const res = await request(app).post('/auth/login').send({});

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      status: 'error',
      error: { code: 'RATE_LIMIT_EXCEEDED' },
    });
    expect(res.body.error.message).toContain('login');
    expect(res.headers['retry-after']).toBe('60');
  });
});

describe('passwordResetRateLimit', () => {
  it('shares ONE budget across /password-reset and /password-reset/confirm, not one each', async () => {
    // max is 2 for this suite (mocked env) -- one to each endpoint should
    // exhaust the SHARED budget, proving they are not counted separately.
    const first = await request(app).post('/auth/password-reset').send({});
    const second = await request(app).post('/auth/password-reset/confirm').send({});
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const third = await request(app).post('/auth/password-reset').send({});
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

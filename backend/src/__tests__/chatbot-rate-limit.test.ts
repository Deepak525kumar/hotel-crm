import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Rate limiting for the chatbot, keyed on the authenticated user.
 *
 * The behaviour under test is not "a 429 happens" but the two properties the
 * limiter exists for and which are easy to break silently:
 *
 *  1. One user's burst must not throttle another user. The login limiter is
 *     IP-keyed, and copying that here would have thrown a whole hotel's staff
 *     off the assistant because they share an office NAT.
 *  2. It bounds RATE, which the token budgets do not. A loop of turns that
 *     FAIL before recordSpend advances no budget counter at all, so the
 *     budget cannot see it; only this can.
 */

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: unknown[]) => unknown>,
    warn: jest.fn() as jest.MockedFunction<(...args: unknown[]) => unknown>,
    debug: jest.fn() as jest.MockedFunction<(...args: unknown[]) => unknown>,
    error: jest.fn() as jest.MockedFunction<(...args: unknown[]) => unknown>,
  },
}));

const TURN_MAX = 3;
const ACTION_MAX = 5;

/**
 * THE RESIDUAL FLAKE, FOUND AND FIXED 2026-09-10.
 *
 * This was 60_000 -- the real production window -- and it made the suite fail
 * roughly once in every twenty full runs, always here, always the same way:
 *
 *     ● chatbot rate limiting › rejects the turn after the limit with a 429
 *       Expected: 429
 *       Received: 200
 *
 * `express-rate-limit`'s memory store clears its counters on an interval
 * anchored to when the store was created -- which is `beforeEach`, when the
 * limiter is constructed. Every test here fills the quota and then asserts
 * that ONE more request is refused. If that interval fires between the fill
 * and the assertion, the counter is back at zero and the request is allowed.
 * Nothing in the test is wrong; it just depends on wall-clock time not
 * crossing a boundary while it runs, and under a long serial run it sometimes
 * does.
 *
 * It cost hours to find, because it presents as "some unrelated suite failed
 * once, passes alone, passes on re-run" -- the same shape as genuine
 * cross-file pollution, which is what it was mistaken for.
 *
 * An hour-long window removes the dependency entirely rather than making it
 * less likely: no test here asserts anything about the window EXPIRING, so
 * its length was never part of what is under test. Fake timers were the
 * alternative and are worse -- `express-rate-limit` reads the clock inside
 * the library, so faking it tests the mock's behaviour as much as the
 * limiter's.
 */
const WINDOW_MS = 3_600_000;

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    CHATBOT_RATE_LIMIT_WINDOW_MS: WINDOW_MS,
    CHATBOT_TURN_RATE_LIMIT_MAX: TURN_MAX,
    CHATBOT_ACTION_RATE_LIMIT_MAX: ACTION_MAX,
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: unknown[]) => unknown>,
}));

import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import {
  chatbotActionRateLimit,
  chatbotTurnRateLimit,
} from '../modules/chatbot/guardrails/rate-limit.js';
import { TooManyRequestsError } from '../lib/errors.js';

/** A minimal app: fake auth, the limiter under test, an always-200 handler. */
function makeApp(limiter: express.RequestHandler) {
  const app = express();

  // Stands in for authMiddleware. The user id arrives in a header purely so
  // a test can switch identity between requests.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.header('x-test-user');
    if (userId) {
      req.auth = { userId, email: `${userId}@example.test`, role: 'worker', permissions: [] };
    }
    next();
  });

  app.post('/go', limiter, (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof TooManyRequestsError ? 429 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'unknown' });
  });

  return app;
}

async function fire(app: express.Express, user: string, times: number): Promise<number[]> {
  const codes: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const res = await request(app).post('/go').set('x-test-user', user);
    codes.push(res.status);
  }
  return codes;
}

describe('chatbot rate limiting', () => {
  let app: express.Express;

  beforeEach(() => {
    // A fresh limiter per test: express-rate-limit keeps counters in the
    // middleware instance, so reusing one would leak state between cases.
    app = makeApp(chatbotTurnRateLimit());
  });

  it('allows a user up to the configured number of turns', async () => {
    const codes = await fire(app, 'u1', TURN_MAX);
    expect(codes).toEqual(Array(TURN_MAX).fill(200));
  });

  it('rejects the turn after the limit with a 429', async () => {
    await fire(app, 'u1', TURN_MAX);
    const res = await request(app).post('/go').set('x-test-user', 'u1');
    expect(res.status).toBe(429);
  });

  it('raises the app\'s own TooManyRequestsError, not the library default', async () => {
    await fire(app, 'u1', TURN_MAX);
    const res = await request(app).post('/go').set('x-test-user', 'u1');
    // The login limiter's convention: one envelope whatever the layer.
    expect(res.body.error).toMatch(/too many chatbot messages/i);
  });

  /**
   * THE PROPERTY THAT MADE THIS PER-USER RATHER THAN PER-IP.
   *
   * Under an IP key these two callers share one bucket, because in the real
   * deployment a hotel's staff share one office NAT. One worker's runaway
   * client would then throttle every colleague -- a self-inflicted outage
   * dressed as a defense.
   */
  it('does not let one user exhaust another user\'s allowance', async () => {
    const exhausted = await fire(app, 'worker-a', TURN_MAX + 1);
    expect(exhausted[exhausted.length - 1]).toBe(429);

    // Same app instance, same simulated IP, different person.
    const colleague = await request(app).post('/go').set('x-test-user', 'worker-b');
    expect(colleague.status).toBe(200);
  });

  it('applies a separate, looser bound to non-model actions', async () => {
    const actions = makeApp(chatbotActionRateLimit());
    const codes = await fire(actions, 'u1', ACTION_MAX);
    expect(codes).toEqual(Array(ACTION_MAX).fill(200));

    const overflow = await request(actions).post('/go').set('x-test-user', 'u1');
    expect(overflow.status).toBe(429);
    expect(overflow.body.error).toMatch(/too many chatbot requests/i);
  });

  it('keeps the two limits independent of one another', async () => {
    // Exhausting turns must not consume the action allowance: a user who has
    // been talking fast can still confirm or start a conversation.
    const actions = makeApp(chatbotActionRateLimit());
    await fire(app, 'u1', TURN_MAX + 1);

    const res = await request(actions).post('/go').set('x-test-user', 'u1');
    expect(res.status).toBe(200);
  });

  /**
   * An unauthenticated request cannot reach these routes (authMiddleware runs
   * first), but if `req.auth` were ever absent, an undefined key makes
   * express-rate-limit put EVERY caller in one shared bucket -- a
   * platform-wide lockout. The fallback to IP must keep them separable.
   */
  it('falls back to a per-address key rather than one shared bucket', async () => {
    const res = await request(app).post('/go');
    expect(res.status).toBe(200);
    // Still bounded, not unbounded.
    for (let i = 0; i < TURN_MAX; i += 1) await request(app).post('/go');
    const over = await request(app).post('/go');
    expect(over.status).toBe(429);
  });
});

/**
 * The in-memory store is an accurate GLOBAL limit only because the backend
 * runs one process. Under cluster mode with N workers the effective limit
 * becomes N x max -- nothing errors, it just quietly stops bounding what it
 * says it bounds. Asserted against the real config file rather than trusted.
 */
describe('the single-process assumption the in-memory store depends on', () => {
  it('still holds in ecosystem.config.js', () => {
    const config = readFileSync(
      path.join(process.cwd(), '..', 'ecosystem.config.js'),
      'utf8'
    );

    expect(config).toMatch(/exec_mode:\s*'fork'/);
    expect(config).toMatch(/instances:\s*1/);
    // If this fails, the limiter needs a shared store (Redis or the DB)
    // before the process model changes -- not after.
    expect(config).not.toMatch(/exec_mode:\s*'cluster'/);
  });
});

/**
 * REGRESSION: the key generator must use `ipKeyGenerator` for its IP fallback.
 *
 * A raw IPv6 address is per-DEVICE -- an attacker holding a /64 has billions
 * of them -- so keying on the bare address is barely a limit at all for anyone
 * on IPv6. The helper normalises to the subnet.
 *
 * Found by booting the compiled server with FEATURE_CHATBOT=true, not by this
 * suite: express-rate-limit LOGS `ERR_ERL_KEY_GEN_IPV6` and continues rather
 * than throwing, so nothing failed anywhere -- every start simply printed a
 * ValidationError that any reader would treat as a fault.
 *
 * Because construction cannot throw, the guard asserts the same SOURCE SHAPE
 * the library itself checks for. That is a source-text assertion, which is
 * usually a smell; here it is exactly the contract, because the library's rule
 * is literally "the function's source mentions ipKeyGenerator".
 */
describe('the IP fallback is IPv6-safe', () => {
  const source = readFileSync('src/modules/chatbot/guardrails/rate-limit.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('routes the address through ipKeyGenerator', () => {
    const fn = source.slice(source.indexOf('function keyByUser'));
    const body = fn.slice(0, fn.indexOf('\n}'));

    expect(body).toContain('req.ip');
    // The exact condition express-rate-limit enforces.
    expect(body).toContain('ipKeyGenerator');
  });

  it('still keys authenticated callers by user, not by address', async () => {
    // The IPv6 helper applies to the FALLBACK only. The property the limiter
    // exists for -- one worker's burst not throttling a colleague behind the
    // same office NAT -- must be untouched by that fix.
    const app = makeApp(chatbotTurnRateLimit());
    await fire(app, 'worker-a', TURN_MAX + 1);
    const colleague = await request(app).post('/go').set('x-test-user', 'worker-b');
    expect(colleague.status).toBe(200);
  });
});

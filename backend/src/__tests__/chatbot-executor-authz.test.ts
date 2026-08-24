import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * The authorization boundary for backend-chatbot (SPEC-CHATBOT-001,
 * ADR-053 item 3).
 *
 * This suite exists BEFORE any model is wired, deliberately. The executor is
 * the one place where an untrusted tool request becomes a real service call,
 * so it is proven first — with zero AI in the loop — and whatever the model
 * path later produces is subject to exactly what is asserted here.
 *
 * What is guarded:
 *  - the allow-list (an invented tool name never executes)
 *  - argument validation (strict schema; unexpected keys rejected)
 *  - the forbidden-argument invariant (no identity/role/scope/permission and
 *    no `internalBypass` may ever arrive as a tool argument)
 *  - live permission checking against req.auth.permissions
 *  - that a self-scoped caller cannot reach another worker's rows, because
 *    the owning service re-narrows by actor.userId
 */

let testAuth: {
  userId: string;
  role: string;
  permissions?: string[];
  scope?: unknown;
} | null = null;

// Rows the mocked assignment query returns, per worker id.
const ASSIGNMENT_ROWS = [
  { id: 'a1', worker_id: 'w1', hotel_id: 'h1' },
  { id: 'a2', worker_id: 'w2', hotel_id: 'h1' },
];

// Captured so a test can assert what the service was actually asked for —
// the difference between "returned nothing" and "was correctly narrowed".
let lastAssignmentWhere: Record<string, unknown> | null = null;
let lastAuditRow: Record<string, unknown> | null = null;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    FEATURE_CHATBOT: true,
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

jest.mock('../config/feature-flags.js', () => ({
  isChatbotEnabled: () => true,
  isEmploymentRecordEnabled: () => false,
  isJobDispatchPhase2Enabled: () => false,
  isGD02MatrixEnabled: () => false,
  isConsentGateEnabled: () => false,
  getConsentGateRoles: () => [],
}));

jest.mock('../lib/db.js', () => {
  const prisma: any = {
    workerAssignment: {
      findMany: async ({ where }: any) => {
        lastAssignmentWhere = where;
        return ASSIGNMENT_ROWS.filter((row) => {
          if (where?.worker_id && row.worker_id !== where.worker_id) return false;
          if (where?.hotel_id?.in && !where.hotel_id.in.includes(row.hotel_id)) return false;
          if (typeof where?.hotel_id === 'string' && row.hotel_id !== where.hotel_id) return false;
          return true;
        }).map((row) => ({
          ...row,
          work_request_id: null,
          job_request_id: null,
          rework_of_assignment_id: null,
          assigned_by_id: 'mgr1',
          status: 'CONFIRMED',
          confirmed_at: new Date('2026-06-01T00:00:00Z'),
          started_at: null,
          completed_at: null,
          cancelled_at: null,
          cancellation_reason: null,
          updated_at: new Date('2026-06-01T00:00:00Z'),
          rooms_completed_entry: null,
        }));
      },
      count: async () => 2,
    },
    // Reached only when list() returns rows (batched lookup, not N+1).
    roomsCompletedEntry: { findMany: async () => [] },
    user: { findMany: async () => [] },
    auditLog: {
      create: async ({ data }: any) => {
        lastAuditRow = data;
        return data;
      },
    },
    $transaction: async (cb: (tx: any) => Promise<unknown>) => cb(prisma),
  };
  return { getPrisma: () => prisma };
});

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import chatbotRouter from '../modules/chatbot/routes.js';
import { registerTool } from '../modules/chatbot/tools/registry.js';
import { AppError } from '../lib/errors.js';

// The executor's permission gate must be tested against a tool that actually
// declares a token. Pinning that coverage to whichever real tool happens to
// require one is fragile — `assignments.list_mine` legitimately requires none
// (GET /assignments is authMiddleware-only), and when it changed to null it
// silently took four gate assertions with it. This fixture owns that coverage.
const GATED_TOOL = 'test.requires_staffing_read';
registerTool({
  name: GATED_TOOL,
  description: 'Test fixture: a tool that genuinely requires a permission token.',
  tier: 'READ_ONLY',
  confirm: false,
  interfaceRef: 'none (test fixture)',
  approvalRef: 'none (test fixture)',
  args: z.object({}).strict(),
  permission: 'staffing:read',
  scopeCheck: 'none',
  invoke: async () => [],
  compress: () => ({ summary: 'ok', data: [] }),
  maxResultTokens: 10,
});

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/chatbot', chatbotRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

const WORKER = {
  userId: 'w1',
  role: 'worker',
  permissions: ['staffing:read'],
  scope: null,
};

beforeEach(() => {
  testAuth = null;
  lastAssignmentWhere = null;
  lastAuditRow = null;
});

describe('chatbot tool executor — allow-list', () => {
  it('denies a tool name that is not registered (403, never executed)', async () => {
    testAuth = WORKER;
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.delete_everything', args: {} });

    expect(res.status).toBe(403);
    expect(lastAssignmentWhere).toBeNull(); // service was never reached
  });

  it('denies inherited Object.prototype members used as tool names', async () => {
    testAuth = WORKER;
    for (const name of ['constructor', '__proto__', 'toString', 'valueOf']) {
      const res = await request(makeApp())
        .post('/chatbot/tools/invoke')
        .send({ tool: name, args: {} });
      expect(res.status).toBe(403);
    }
    expect(lastAssignmentWhere).toBeNull();
  });
});

describe('chatbot tool executor — argument validation', () => {
  it('rejects an unexpected argument key rather than ignoring it (strict schema)', async () => {
    testAuth = WORKER;
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.list_mine', args: { limit: 5, sneaky: true } });

    expect(res.status).toBe(403);
    expect(lastAssignmentWhere).toBeNull();
  });

  it('rejects an out-of-range argument value', async () => {
    testAuth = WORKER;
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.list_mine', args: { limit: 9999 } });

    expect(res.status).toBe(403);
  });

  /**
   * The core invariant. Every one of these keys is an authorization input; a
   * tool call carrying one must never execute, regardless of the value.
   */
  it.each([
    ['worker_id', 'w2'],
    ['workerId', 'w2'],
    ['user_id', 'w2'],
    ['userId', 'w2'],
    ['actor_id', 'w2'],
    ['role', 'admin'],
    ['permissions', ['admin:*']],
    ['scope', { type: 'global' }],
    ['hotel_id', 'h9'],
    ['internalBypass', true],
    ['internal_bypass', true],
  ])('refuses a tool call carrying the authorization argument %s', async (key, value) => {
    testAuth = WORKER;
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.list_mine', args: { [key]: value } });

    expect(res.status).toBe(403);
    expect(lastAssignmentWhere).toBeNull();
  });
});

describe('chatbot tool executor — live permission check', () => {
  it('denies a caller lacking the tool permission token', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: GATED_TOOL, args: {} });

    expect(res.status).toBe(403);
  });

  it('allows a caller holding the exact token', async () => {
    testAuth = WORKER;
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.list_mine', args: {} });

    expect(res.status).toBe(200);
  });

  it('honours a resource wildcard (staffing:*)', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: ['staffing:*'], scope: null };
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.list_mine', args: {} });

    expect(res.status).toBe(200);
  });

  it('honours the admin:* bypass', async () => {
    testAuth = { userId: 'admin1', role: 'admin', permissions: ['admin:*'], scope: null };
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.list_mine', args: {} });

    expect(res.status).toBe(200);
  });

  it('does NOT honour an unrelated resource wildcard', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: ['hr:*'], scope: null };
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: GATED_TOOL, args: {} });

    expect(res.status).toBe(403);
  });

  it('runs a token-less tool for a caller holding no permissions at all', async () => {
    // assignments.list_mine declares permission: null because GET /assignments
    // enforces none. The other four gate steps still run — this asserts the
    // null case is a modelled state, not an accidental bypass.
    testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.list_mine', args: {} });

    expect(res.status).toBe(200);
    expect(lastAssignmentWhere?.worker_id).toBe('w1'); // still self-scoped
  });
});

describe('chatbot tool executor — self-scoping (RULE-CHAT-09 / REQ-CHAT-013)', () => {
  /**
   * The verification that matters: not just "the response looked right", but
   * that the query the service actually issued was narrowed to the
   * authenticated worker. A 200 with unfiltered rows would be the defect.
   */
  it('narrows a self-scoped caller to their own rows at the query layer', async () => {
    testAuth = WORKER;
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.list_mine', args: {} });

    expect(res.status).toBe(200);
    expect(lastAssignmentWhere?.worker_id).toBe('w1');

    const ids = (res.body.data.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(['a1']);
    expect(ids).not.toContain('a2'); // another worker's row
  });

  it('a manager with no scope claim resolves to an empty hotel set, not platform-wide', async () => {
    testAuth = {
      userId: 'mgr1',
      role: 'manager',
      permissions: ['staffing:read'],
      scope: null,
    };
    const res = await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.list_mine', args: {} });

    expect(res.status).toBe(200);
    // The service's own IDOR fix (assignments/service.ts:262) applies: a
    // scoped manager role with no claim gets `hotel_id: { in: [] }`.
    expect(lastAssignmentWhere?.hotel_id).toEqual({ in: [] });
  });
});

describe('chatbot tool executor — audit', () => {
  it('writes an AI-mediated-path audit row on success', async () => {
    testAuth = WORKER;
    await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: 'assignments.list_mine', args: {} });

    expect(lastAuditRow?.action).toBe('chatbot.tool.execute');
    expect(lastAuditRow?.resource_type).toBe('CHATBOT_TOOL_CALL');
    expect((lastAuditRow?.details as any)?.outcome).toBe('SUCCESS');
  });

  it('writes an audit row on denial too, carrying the denial code', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    await request(makeApp())
      .post('/chatbot/tools/invoke')
      .send({ tool: GATED_TOOL, args: {} });

    expect((lastAuditRow?.details as any)?.outcome).toBe('DENIED');
    expect((lastAuditRow?.details as any)?.denial_code).toBe('MISSING_PERMISSION');
  });
});

describe('chatbot tool manifest', () => {
  it('omits a tool whose token the caller does not hold', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    const res = await request(makeApp()).get('/chatbot/tools');

    expect(res.status).toBe(200);
    const names = res.body.data.map((t: { name: string }) => t.name);
    expect(names).not.toContain(GATED_TOOL);
    // ...but a token-less tool stays visible, since nothing gates it.
    expect(names).toContain('assignments.list_mine');
  });

  it('lists the tool once the caller holds its token', async () => {
    testAuth = WORKER;
    const res = await request(makeApp()).get('/chatbot/tools');

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { name: string }) => t.name)).toContain('assignments.list_mine');
  });
});

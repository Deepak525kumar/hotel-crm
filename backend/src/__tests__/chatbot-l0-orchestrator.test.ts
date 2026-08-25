import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * L0 — the deterministic, zero-LLM path, end to end through the real router
 * stack: HTTP → controller → service → orchestrator → executor → the real
 * assignmentService.
 *
 * The claim under test is the one that makes this useful before any API key
 * exists: a worker can ask for their shifts and get a correct, correctly
 * scoped answer with **no provider configured at all**.
 */

let testAuth: any = null;
let conversationRow: any = null;
let lastAssignmentWhere: any = null;
let providerCalls = 0;

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
    CHATBOT_MONTHLY_TOKEN_CAP: 1000000,
    CHATBOT_CONVERSATION_TOKEN_CAP: 25000,
    CHATBOT_USER_DAILY_TOKEN_CAP: 60000,
    CHATBOT_MAX_TOOL_CALLS_PER_TURN: 5,
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

jest.mock('../lib/db.js', () => {
  const prisma: any = {
    chatbotConversation: {
      create: async ({ data }: any) => {
        conversationRow = { id: 'c1', turn_count: 0, tokens_input: 0, tokens_output: 0, ...data };
        return conversationRow;
      },
      findUnique: async () => conversationRow,
      update: async ({ data }: any) => {
        if (data.turn_count?.increment) conversationRow.turn_count += data.turn_count.increment;
        if (data.status) conversationRow.status = data.status;
        return conversationRow;
      },
      aggregate: async () => ({ _sum: { tokens_input: 0, tokens_output: 0 } }),
    },
    chatbotBudgetCounter: { findUnique: async () => null, upsert: async () => ({}) },
    workerAssignment: {
      findMany: async ({ where }: any) => {
        lastAssignmentWhere = where;
        return [
          {
            id: 'a1',
            worker_id: 'w1',
            hotel_id: 'h1',
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
          },
        ];
      },
      count: async () => 1,
    },
    roomsCompletedEntry: { findMany: async () => [] },
    user: { findMany: async () => [] },
    // AssignmentService.list() nests hotel details and shift times in the DTO
    // (so a worker can see where and when their shift is), which the
    // assignments.list_mine tool reaches through. Empty results keep these
    // fixtures' assertions about the reply text unchanged.
    hotel: { findMany: async () => [] },
    jobRequest: { findMany: async () => [] },
    auditLog: { create: async () => ({}) },
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
import chatbotRouter from '../modules/chatbot/routes.js';
import { AppError } from '../lib/errors.js';
import { setProvider, getProvider } from '../modules/chatbot/provider/llm-provider.js';
import { matchL0, commandManifest, normalize } from '../modules/chatbot/orchestrator/router-l0.js';

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

const WORKER = { userId: 'w1', role: 'worker', permissions: ['staffing:read'], scope: null };

beforeEach(() => {
  testAuth = WORKER;
  conversationRow = null;
  lastAssignmentWhere = null;
  providerCalls = 0;
  setProvider(null);
});

describe('L0 phrase matching', () => {
  it('matches known phrases regardless of case and punctuation', () => {
    expect(matchL0('My Shifts')?.id).toBe('my_shifts');
    expect(matchL0('  what are my shifts?  ')?.id).toBe('my_shifts');
    expect(matchL0('Meine Schichten')?.id).toBe('my_shifts');
  });

  it('does NOT guess at an unrecognized phrase (falls through to L1)', () => {
    expect(matchL0('can someone cover my thursday')).toBeUndefined();
    expect(matchL0('')).toBeUndefined();
  });

  it('normalizes consistently', () => {
    expect(normalize('  My   SHIFTS!! ')).toBe('my shifts');
  });

  it('exposes a manifest for the client to render as chips', () => {
    expect(commandManifest().map((c) => c.id)).toContain('my_shifts');
  });
});

describe('L0 end to end with NO provider configured', () => {
  it('answers "my shifts" correctly, spending zero LLM calls', async () => {
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});
    expect(started.status).toBe(201);

    const res = await request(app)
      .post(`/chatbot/conversations/${started.body.data.id}/messages`)
      .send({ text: 'my shifts' });

    expect(res.status).toBe(200);
    expect(res.body.data.route).toBe('L0');
    expect(res.body.data.toolInvoked).toBe('assignments.list_mine');
    expect(res.body.data.reply).toContain('1 shift');
    expect(getProvider()).toBeNull(); // proves no provider was involved
    expect(providerCalls).toBe(0);
  });

  it('resolves a chip tap by id without parsing any text', async () => {
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});
    const res = await request(app)
      .post(`/chatbot/conversations/${started.body.data.id}/messages`)
      .send({ command_id: 'my_shifts' });

    expect(res.status).toBe(200);
    expect(res.body.data.route).toBe('L0');
  });

  it('still enforces self-scoping on the L0 path', async () => {
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});
    await request(app)
      .post(`/chatbot/conversations/${started.body.data.id}/messages`)
      .send({ text: 'my shifts' });

    // L0 is a cheaper route to the same boundary, not a bypass.
    expect(lastAssignmentWhere?.worker_id).toBe('w1');
  });

  it('works for a caller with the REAL worker permission set (regression)', async () => {
    // The defect this guards: assignments.list_mine once required
    // `staffing:read`, which WORKER does not hold — so the tool built for
    // workers denied every worker, and every suite passed because they all
    // fabricated the permission. Uses the real set, not an invented one.
    const { ROLE_PERMISSIONS } = await import('../config/constants.js');
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});
    testAuth = {
      userId: 'w1',
      role: 'worker',
      permissions: [...(ROLE_PERMISSIONS.WORKER ?? [])],
      scope: null,
    };

    const res = await request(app)
      .post(`/chatbot/conversations/${started.body.data.id}/messages`)
      .send({ text: 'my shifts' });

    expect(res.status).toBe(200);
    expect(res.body.data.route).toBe('L0');
    expect(res.body.data.toolInvoked).toBe('assignments.list_mine');
    expect(lastAssignmentWhere?.worker_id).toBe('w1');
  });

  it('degrades gracefully on free text instead of erroring', async () => {
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});
    const res = await request(app)
      .post(`/chatbot/conversations/${started.body.data.id}/messages`)
      .send({ text: 'who can cover the kitchen this weekend' });

    expect(res.status).toBe(200);
    expect(res.body.data.route).toBe('none');
    expect(res.body.data.reply).toContain('quick commands');
  });
});

describe('conversation self-scoping (RULE-CHAT-09)', () => {
  it('refuses a turn on another worker’s conversation', async () => {
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});

    testAuth = { userId: 'intruder', role: 'worker', permissions: ['staffing:read'], scope: null };
    const res = await request(app)
      .post(`/chatbot/conversations/${started.body.data.id}/messages`)
      .send({ text: 'my shifts' });

    expect(res.body.data.reply).toBe('You do not have access to that.');
    expect(lastAssignmentWhere).toBeNull();
  });

  it('refuses an outcome read for another worker’s conversation', async () => {
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});

    testAuth = { userId: 'intruder', role: 'worker', permissions: ['staffing:read'], scope: null };
    const res = await request(app).get(`/chatbot/conversations/${started.body.data.id}`);
    expect(res.status).toBe(403);
  });

  it('returns outcome only — never a transcript (OD-CHAT-008 still open)', async () => {
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});
    const res = await request(app).get(`/chatbot/conversations/${started.body.data.id}`);

    expect(Object.keys(res.body.data).sort()).toEqual(['id', 'purpose', 'status']);
  });
});

describe('request validation', () => {
  it('requires exactly one of text or command_id', async () => {
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});
    const both = await request(app)
      .post(`/chatbot/conversations/${started.body.data.id}/messages`)
      .send({ text: 'my shifts', command_id: 'my_shifts' });
    const neither = await request(app)
      .post(`/chatbot/conversations/${started.body.data.id}/messages`)
      .send({});

    expect(both.status).toBe(422);
    expect(neither.status).toBe(422);
  });

  it('refuses a worker-chosen conversation purpose (Security FIND-NEW-002)', async () => {
    const res = await request(makeApp())
      .post('/chatbot/conversations')
      .send({ purpose: 'GDPR_SUBJECT_RIGHTS' });

    expect(res.status).toBe(422);
  });
});

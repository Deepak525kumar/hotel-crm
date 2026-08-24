import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * `ChatbotToolCall` persistence and write idempotency.
 *
 * Two claims under test:
 *  1. Every tool execution leaves a durable row — including denials, whose
 *     audit value is at least as high as successes.
 *  2. The row records an args HASH and never the argument values, because
 *     arguments routinely carry personal data and a second copy under
 *     different retention rules is a GDPR problem invented for debugging.
 */

let testAuth: any = null;
let conversationRow: any = null;
let toolCallRows: any[] = [];

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
        return conversationRow;
      },
      aggregate: async () => ({ _sum: { tokens_input: 0, tokens_output: 0 } }),
    },
    chatbotToolCall: {
      create: async ({ data }: any) => {
        if (toolCallRows.some((r) => r.idempotency_key === data.idempotency_key)) {
          const err: any = new Error('unique violation');
          err.code = 'P2002';
          throw err;
        }
        toolCallRows.push(data);
        return { id: `tc${toolCallRows.length}` };
      },
      findUnique: async ({ where }: any) =>
        toolCallRows.find((r) => r.idempotency_key === where.idempotency_key) ?? null,
    },
    chatbotBudgetCounter: { findUnique: async () => null, upsert: async () => ({}) },
    workerAssignment: {
      findMany: async () => [
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
      ],
      count: async () => 1,
    },
    roomsCompletedEntry: { findMany: async () => [] },
    user: { findMany: async () => [] },
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
import { setProvider } from '../modules/chatbot/provider/llm-provider.js';
import { argsHash, idempotencyKey, canonicalJson } from '../modules/chatbot/tools/executor.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/chatbot', chatbotRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err instanceof AppError ? err.statusCode : 500).json({ error: err.name });
  });
  return app;
}

const WORKER = { userId: 'w1', role: 'worker', permissions: ['staffing:read'], scope: null };

beforeEach(() => {
  testAuth = WORKER;
  conversationRow = null;
  toolCallRows = [];
  setProvider(null);
});

describe('tool-call log', () => {
  it('records a row for a successful L0 tool call', async () => {
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});
    await request(app)
      .post(`/chatbot/conversations/${started.body.data.id}/messages`)
      .send({ command_id: 'my_shifts' });

    expect(toolCallRows).toHaveLength(1);
    expect(toolCallRows[0]).toMatchObject({
      tool_name: 'assignments.list_mine',
      tier: 'READ_ONLY',
      status: 'SUCCESS',
      confirmed: false,
    });
  });

  it('records denials too, with the denial code', async () => {
    // Exercised directly rather than end-to-end: no L0 command currently maps
    // to a token-gated tool, so there is no HTTP path that produces a denial
    // here. The recording logic is what matters and is what is asserted.
    const { recordToolCall } = await import('../modules/chatbot/tools/tool-call-log.js');
    await recordToolCall({
      conversationId: 'c1',
      turnIndex: 0,
      toolName: 'assignments.list_mine',
      tier: 'READ_ONLY',
      args: {},
      confirmed: false,
      outcome: { status: 'DENIED', reason: 'nope', denialCode: 'MISSING_PERMISSION' },
    });

    expect(toolCallRows).toHaveLength(1);
    expect(toolCallRows[0].status).toBe('DENIED');
    expect(toolCallRows[0].denial_reason).toBe('MISSING_PERMISSION');
  });

  it('treats a duplicate idempotency key as a duplicate, not an error', async () => {
    const { recordToolCall } = await import('../modules/chatbot/tools/tool-call-log.js');
    const call = {
      conversationId: 'c1',
      turnIndex: 0,
      toolName: 'assignments.list_mine',
      tier: 'LOW_RISK_WRITE',
      args: { a: 1 },
      confirmed: true,
      outcome: { status: 'SUCCESS' as const, result: { summary: '', data: null }, durationMs: 1 },
    };
    const first = await recordToolCall(call);
    const second = await recordToolCall(call);

    expect(first?.skippedAsDuplicate).toBe(false);
    expect(second?.skippedAsDuplicate).toBe(true);
    expect(toolCallRows).toHaveLength(1); // the unique constraint held
  });

  it('stores an args hash and never the argument values', async () => {
    const app = makeApp();
    const started = await request(app).post('/chatbot/conversations').send({});
    await request(app)
      .post(`/chatbot/conversations/${started.body.data.id}/messages`)
      .send({ command_id: 'my_upcoming_shifts' }); // carries args {status:'CONFIRMED'}

    const row = toolCallRows[0];
    expect(row.args_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(row)).not.toContain('args');
    expect(JSON.stringify(row)).not.toContain('CONFIRMED');
  });
});

describe('idempotency key', () => {
  it('is stable regardless of argument key order', () => {
    const a = idempotencyKey('c1', 0, 't', { b: 2, a: 1 });
    const b = idempotencyKey('c1', 0, 't', { a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('differs across conversation, turn, tool and args', () => {
    const base = idempotencyKey('c1', 0, 't', { a: 1 });
    expect(idempotencyKey('c2', 0, 't', { a: 1 })).not.toBe(base);
    expect(idempotencyKey('c1', 1, 't', { a: 1 })).not.toBe(base);
    expect(idempotencyKey('c1', 0, 'u', { a: 1 })).not.toBe(base);
    expect(idempotencyKey('c1', 0, 't', { a: 2 })).not.toBe(base);
  });

  it('canonicalizes nested objects and ignores undefined', () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: undefined })).toBe('{"b":{"c":2,"d":1}}');
  });

  it('hashes args independently of the conversation (for confirmation binding)', () => {
    expect(argsHash({ a: 1 })).toBe(argsHash({ a: 1 }));
    expect(argsHash({ a: 1 })).not.toBe(argsHash({ a: 2 }));
  });
});

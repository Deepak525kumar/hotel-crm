import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { z } from 'zod';

/**
 * A CONFIRMATION MUST STATE WHAT WILL ACTUALLY HAPPEN.
 *
 * Production, 2026-09-10. A manager asked to place "worker 1" at "hotel 1".
 * They were shown the call, they confirmed it, and only then were told
 * `No hotel matching "hotel 1" is in your scope.` The approval authorised
 * something that could never run, and nothing they were shown said so.
 *
 * The gate already parsed arguments first, commenting that it did so to stop
 * anyone "approving a fiction". That was right about the goal and half the
 * implementation: a schema proves arguments are WELL FORMED, never that what
 * they NAME exists.
 *
 * These tests pin the general rule, not the one tool that exposed it.
 */

let sessionState: Record<string, unknown> = {};
const conversationRow = () => ({
  id: 'conv_1',
  worker_id: 'mgr_1',
  status: 'IN_PROGRESS',
  turn_count: 1,
  tokens_input: 0,
  tokens_output: 0,
  session_state: sessionState,
});

const mockPrisma = {
  chatbotConversation: {
    findUnique: jest.fn(async () => conversationRow()) as any,
    update: jest.fn(async ({ data }: any) => {
      if (data?.session_state !== undefined) sessionState = data.session_state;
      return conversationRow();
    }) as any,
    aggregate: jest.fn(async () => ({ _sum: { tokens_input: 0, tokens_output: 0 } })) as any,
  },
  chatbotToolCall: {
    create: jest.fn(async () => ({ id: 'tc_1' })) as any,
    findUnique: jest.fn(async () => null) as any,
    findFirst: jest.fn(async () => null) as any,
  },
  chatbotBudgetCounter: {
    findUnique: jest.fn(async () => null) as any,
    upsert: jest.fn(async () => ({})) as any,
  },
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    CHATBOT_CONFIRM_TOKEN_SECRET: 'a-test-signing-secret-at-least-32-chars',
    CHATBOT_MONTHLY_TOKEN_CAP: 25_000_000,
    CHATBOT_CONVERSATION_TOKEN_CAP: 120_000,
    CHATBOT_USER_DAILY_TOKEN_CAP: 250_000,
    CHATBOT_MAX_TOOL_CALLS_PER_TURN: 5,
    JWT_SECRET: 'x'.repeat(40),
    JWT_REFRESH_SECRET: 'y'.repeat(40),
  }),
  loadEnv: jest.fn() as any,
}));

const providerCall = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../modules/chatbot/provider/llm-provider.js', () => {
  const actual = jest.requireActual('../modules/chatbot/provider/llm-provider.js') as any;
  return { ...actual, getProvider: () => ({ modelId: 'test', completeWithTools: providerCall }) };
});

const mockResolveHotel = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveWorker = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveHotelReference: mockResolveHotel,
  resolveWorkerReference: mockResolveWorker,
  describeUnresolvedHotel: (r: any) =>
    r.status === 'NOT_FOUND' ? `No hotel matching "${r.query}" is in your scope.` : 'Which hotel?',
  describeUnresolved: (r: any) => `No worker matching "${r.query}".`,
}));

const writeInvoke = jest.fn(async () => ({ placed: true })) as any;

import { registerTool } from '../modules/chatbot/tools/registry.js';
import { runTurn } from '../modules/chatbot/orchestrator/orchestrator.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const TOOL = 'test.place_with_references';
registerTool({
  name: TOOL,
  description: 'fixture: a high-risk write naming a hotel and a worker',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,
  interfaceRef: 'none (test fixture)',
  approvalRef: 'none (test fixture)',
  args: z
    .object({
      worker_name: z.string(),
      day: z.string(),
      hotel_name: z.string().optional(),
    })
    .strict(),
  permission: 'staffing:write',
  scopeCheck: 'none',
  invoke: writeInvoke,
  compress: (raw: unknown) => ({ summary: 'placed', data: raw }),
  maxResultTokens: 50,
});

const ACTOR = {
  userId: 'mgr_1',
  role: 'manager',
  permissions: ['staffing:write'],
  scope: null,
} as unknown as ActorContext;

const ask = (input: Record<string, unknown>) => {
  providerCall.mockResolvedValue({
    text: '',
    toolUse: { name: TOOL, input },
    usage: { promptTokens: 10, completionTokens: 2 },
  });
  return runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'place worker 1 at hotel 1' });
};

beforeEach(() => {
  jest.clearAllMocks();
  sessionState = {};
  writeInvoke.mockResolvedValue({ placed: true });
  mockResolveHotel.mockResolvedValue({ status: 'RESOLVED', hotelId: 'h1', name: 'hotel_1_group_1' });
  mockResolveWorker.mockResolvedValue({ status: 'RESOLVED', workerId: 'w1', fullName: 'Anna Braun' });
});

describe('a confirmation is never issued for a call that cannot run', () => {
  /** THE PRODUCTION DEFECT, exactly. */
  it('refuses immediately when the hotel does not exist, instead of asking to confirm', async () => {
    mockResolveHotel.mockResolvedValue({ status: 'NOT_FOUND', query: 'hotel 1' });

    const result = await ask({ worker_name: 'worker 1', day: '2026-09-17', hotel_name: 'hotel 1' });

    expect(result.reply).toMatch(/No hotel matching "hotel 1" is in your scope/);
    expect(result.pendingConfirmation).toBeUndefined();
    expect(writeInvoke).not.toHaveBeenCalled();
  });

  it('parks nothing, so a later "yes" cannot resurrect the impossible call', async () => {
    mockResolveHotel.mockResolvedValue({ status: 'NOT_FOUND', query: 'hotel 1' });
    await ask({ worker_name: 'worker 1', day: '2026-09-17', hotel_name: 'hotel 1' });

    expect((sessionState as any).pending_confirmation).toBeUndefined();
  });

  it('refuses when the WORKER cannot be resolved, for the same reason', async () => {
    mockResolveWorker.mockResolvedValue({ status: 'NOT_FOUND', query: 'worker 1' });

    const result = await ask({ worker_name: 'worker 1', day: '2026-09-17', hotel_name: 'hotel 1' });

    expect(result.reply).toMatch(/No worker matching "worker 1"/);
    expect(result.pendingConfirmation).toBeUndefined();
  });

  it('resolves the hotel BEFORE the worker, because a roster belongs to a hotel', async () => {
    await ask({ worker_name: 'worker 1', day: '2026-09-17', hotel_name: 'hotel 1' });

    expect(mockResolveHotel.mock.invocationCallOrder[0]).toBeLessThan(
      mockResolveWorker.mock.invocationCallOrder[0]
    );
    // And the resolved hotel is what the roster is searched in.
    expect(mockResolveWorker.mock.calls[0][2]).toBe('h1');
  });
});

describe('what the person reads is what will run', () => {
  it('shows the CANONICAL names, not the strings the model guessed', async () => {
    const result = await ask({ worker_name: 'worker 1', day: '2026-09-17', hotel_name: 'hotel 1' });

    const summary = result.pendingConfirmation!.summary;
    expect(summary).toContain('hotel_1_group_1');
    expect(summary).toContain('Anna Braun');
    // The guesses are gone: approving "hotel 1" meant approving nothing.
    expect(summary).not.toMatch(/hotel_name: hotel 1$/m);
  });

  it('parks the canonical arguments, so execution matches the approval', async () => {
    await ask({ worker_name: 'worker 1', day: '2026-09-17', hotel_name: 'hotel 1' });

    const pending = (sessionState as any).pending_confirmation;
    expect(pending.args).toEqual({
      worker_name: 'Anna Braun',
      day: '2026-09-17',
      hotel_name: 'hotel_1_group_1',
    });
  });

  /**
   * The precheck reads the SCHEMA, so an optional hotel the model left out is
   * still resolved -- the tool would resolve one at execution either way, and
   * a confirmation that skipped it would be the same fiction again.
   */
  it('resolves an optional hotel the model omitted entirely', async () => {
    await ask({ worker_name: 'worker 1', day: '2026-09-17' });

    expect(mockResolveHotel).toHaveBeenCalled();
    expect((sessionState as any).pending_confirmation.args.hotel_name).toBe('hotel_1_group_1');
  });

  it('still asks which hotel when the person genuinely has to choose', async () => {
    mockResolveHotel.mockResolvedValue({ status: 'NEEDS_NAME' });

    const result = await ask({ worker_name: 'worker 1', day: '2026-09-17' });

    expect(result.reply).toMatch(/Which hotel/i);
    expect(result.pendingConfirmation).toBeUndefined();
  });
});

/**
 * NAMES INSIDE A LIST -- production, 2026-09-15.
 *
 * A manager scheduled Harvir Singh for three days. `place_many` nests its
 * names in `placements[]`, the precheck only read a top-level `worker_name`,
 * and the manager was shown a confirmation, pressed Confirm, saw "✓ Confirmed"
 * -- and was then told three times that no such worker was on the team.
 */
const BATCH_TOOL = 'test.place_batch_with_references';
const batchInvoke = jest.fn(async () => ({ placed: true })) as any;
registerTool({
  name: BATCH_TOOL,
  description: 'fixture: a high-risk write naming several workers in a list',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,
  interfaceRef: 'none (test fixture)',
  approvalRef: 'none (test fixture)',
  args: z
    .object({
      hotel_name: z.string().optional(),
      placements: z.array(z.object({ worker_name: z.string(), day: z.string() }).strict()),
    })
    .strict(),
  permission: 'staffing:write',
  scopeCheck: 'none',
  invoke: batchInvoke,
  compress: (raw: unknown) => ({ summary: 'placed', data: raw }),
  maxResultTokens: 50,
});

const askBatch = (input: Record<string, unknown>) => {
  providerCall.mockResolvedValue({
    text: '',
    toolUse: { name: BATCH_TOOL, input },
    usage: { promptTokens: 10, completionTokens: 2 },
  });
  return runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'schedule harvir 15 16 17' });
};

const HARVIR = {
  hotel_name: 'Premier Inn',
  placements: [
    { worker_name: 'Harvir Singh', day: '2026-09-15' },
    { worker_name: 'Harvir Singh', day: '2026-09-16' },
    { worker_name: 'Harvir Singh', day: '2026-09-17' },
  ],
};

describe('a confirmation is never issued when a name INSIDE a list cannot run', () => {
  it('refuses before confirming, and parks nothing', async () => {
    mockResolveWorker.mockResolvedValue({ status: 'NOT_FOUND', query: 'Harvir Singh' });

    const result = await askBatch(HARVIR);

    expect(result.pendingConfirmation).toBeUndefined();
    expect((sessionState as any).pending_confirmation).toBeUndefined();
    expect(batchInvoke).not.toHaveBeenCalled();
    expect(result.reply).toMatch(/Harvir Singh/);
  });

  it('says one sentence about one person, not the same sentence three times', async () => {
    mockResolveWorker.mockResolvedValue({ status: 'NOT_FOUND', query: 'Harvir Singh' });

    const result = await askBatch(HARVIR);

    expect(result.reply.match(/No worker matching/g)).toHaveLength(1);
    // And the name is resolved once, not once per day.
    expect(mockResolveWorker).toHaveBeenCalledTimes(1);
  });

  it('refuses a name nested in ANY list, not only placements', async () => {
    mockResolveWorker.mockImplementation(async (q: string) =>
      q === 'Bogdan' ? { status: 'NOT_FOUND', query: q } : { status: 'RESOLVED', workerId: 'w1', fullName: 'Anna Braun' }
    );
    // Same fixture schema shape as calendar.apply_plan's second list.
    const result = await askBatch({ ...HARVIR, placements: [{ worker_name: 'Bogdan', day: '2026-09-21' }] });
    expect(result.pendingConfirmation).toBeUndefined();
    expect(result.reply).toMatch(/Bogdan/);
  });

  it('rewrites every nested name to its canonical form when they all resolve', async () => {
    await askBatch(HARVIR);

    const parked = (sessionState as any).pending_confirmation.args;
    expect(parked.placements.map((p: any) => p.worker_name)).toEqual(['Anna Braun', 'Anna Braun', 'Anna Braun']);
    expect(parked.hotel_name).toBe('hotel_1_group_1');
  });
});

/**
 * THE THING A CALL ACTS ON MUST EXIST, not only the names in it.
 *
 * "Cancel Parveen's shift on the 16th" names a real person and a real day and
 * can still have nothing to cancel. A tool's `precheck` answers that before a
 * confirmation is shown.
 */
const PRECHECK_TOOL = 'test.cancel_with_precheck';
const precheckFn = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const precheckInvoke = jest.fn(async () => ({ cancelled: true })) as any;
registerTool({
  name: PRECHECK_TOOL,
  description: 'fixture: a high-risk write whose target may not exist',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,
  interfaceRef: 'none (test fixture)',
  approvalRef: 'none (test fixture)',
  args: z.object({ worker_name: z.string(), day: z.string() }).strict(),
  permission: 'staffing:write',
  scopeCheck: 'none',
  precheck: precheckFn,
  invoke: precheckInvoke,
  compress: (raw: unknown) => ({ summary: 'cancelled', data: raw }),
  maxResultTokens: 50,
});

const askCancel = () => {
  providerCall.mockResolvedValue({
    text: '',
    toolUse: { name: PRECHECK_TOOL, input: { worker_name: 'parveen kumar', day: '2026-09-16' } },
    usage: { promptTokens: 10, completionTokens: 2 },
  });
  return runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'cancel shift for parveen kumar 16 September' });
};

describe('a tool precheck runs before the confirmation', () => {
  it('answers with the refusal and never asks to confirm', async () => {
    precheckFn.mockResolvedValue({
      refused: { code: 'NOT_FOUND', message: 'Anna Braun has no shift on 2026-09-16.', nextAction: 'ask_user' },
    });

    const result = await askCancel();

    expect(result.reply).toBe('Anna Braun has no shift on 2026-09-16.');
    expect(result.pendingConfirmation).toBeUndefined();
    expect(precheckInvoke).not.toHaveBeenCalled();
  });

  it('receives the CANONICAL arguments the confirmation would show', async () => {
    precheckFn.mockResolvedValue(null);
    await askCancel();
    expect(precheckFn.mock.calls[0]![0]).toEqual({ worker_name: 'Anna Braun', day: '2026-09-16' });
  });

  it('proceeds to the confirmation when there is something to act on', async () => {
    precheckFn.mockResolvedValue(null);
    const result = await askCancel();
    expect(result.pendingConfirmation).toBeDefined();
  });

  /** An early warning that throws must not cost the person their answer. */
  it('falls through to the confirmation when the precheck itself throws', async () => {
    precheckFn.mockRejectedValue(new Error('database hiccup'));
    const result = await askCancel();
    expect(result.pendingConfirmation).toBeDefined();
  });
});

/**
 * WHAT A PERSON READS AFTER A TOOL RUNS WITHOUT CONFIRMATION.
 *
 * Live end-to-end run, 2026-09-15: a new-account link went back into the tool
 * loop and the model's rewrite dropped it; a manager missing one argument was
 * told "You do not have access to that".
 */
const readInvoke = jest.fn(async () => ({ ok: true })) as any;
const makeRead = (name: string, finalAnswer: boolean, tier: 'READ_ONLY' | 'LOW_RISK_WRITE' = 'READ_ONLY') =>
  registerTool({
    name,
    description: 'fixture: an unconfirmed tool whose summary matters',
    tier,
    confirm: false,
    ...(finalAnswer ? { finalAnswer: true } : {}),
    interfaceRef: 'none (test fixture)',
    approvalRef: 'none (test fixture)',
    args: z.object({ first_name: z.string() }).strict(),
    permission: 'staffing:write',
    scopeCheck: 'none',
    invoke: readInvoke,
    compress: () => ({ summary: 'The form is filled in: /users/new#first_name=Mukesh', data: null }),
    maxResultTokens: 50,
  });
makeRead('test.final_read', true);
makeRead('test.looping_read', false);
makeRead('test.unconfirmed_write', false, 'LOW_RISK_WRITE');

const callTool = (name: string, input: Record<string, unknown>) => {
  providerCall.mockReset();
  providerCall
    .mockResolvedValueOnce({ text: '', toolUse: { name, input }, usage: { promptTokens: 10, completionTokens: 2 } })
    .mockResolvedValueOnce({ text: 'The account has been started.', toolUse: null, usage: { promptTokens: 10, completionTokens: 2 } });
  return runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'create id for Mukesh' });
};

describe('a result that must be read exactly is not handed back to the model', () => {
  // Each case queues two model replies; one that returns early leaves the
  // second queued, and it would answer the NEXT describe's turn instead of
  // that describe's own mock. Reset so nothing leaks between tests.
  afterEach(() => providerCall.mockReset());

  it('answers with a finalAnswer tool\'s own summary, link intact, in one model call', async () => {
    const result = await callTool('test.final_read', { first_name: 'Mukesh' });
    expect(result.reply).toBe('The form is filled in: /users/new#first_name=Mukesh');
    expect(providerCall).toHaveBeenCalledTimes(1);
  });

  it('answers with an unconfirmed WRITE\'s own summary -- it has already happened', async () => {
    const result = await callTool('test.unconfirmed_write', { first_name: 'Mukesh' });
    expect(result.reply).toBe('The form is filled in: /users/new#first_name=Mukesh');
    expect(providerCall).toHaveBeenCalledTimes(1);
  });

  it('still lets an ordinary read loop, so a second lookup remains possible', async () => {
    const result = await callTool('test.looping_read', { first_name: 'Mukesh' });
    expect(providerCall).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe('The account has been started.');
  });

  it('says what is missing when the arguments are wrong, not that access is denied', async () => {
    const result = await callTool('test.final_read', {});
    expect(result.reply).not.toMatch(/do not have access/);
    expect(result.reply).toMatch(/still need: first name/);
    expect(readInvoke).not.toHaveBeenCalled();
  });
});

/**
 * A typed L0 match is used only if the person may use its tool. The fixture
 * actor holds `staffing:write` and not `reports:read-team`, so "how much work
 * did we do" -- an L0 intent for the work summary -- must reach the model
 * rather than be answered "You do not have access to that".
 */
describe('a typed L0 match the person cannot use falls through to the model', () => {
  it('asks the model instead of refusing', async () => {
    providerCall.mockReset();
    providerCall.mockResolvedValue({ text: 'Your manager can see the team totals.', toolUse: null, usage: { promptTokens: 5, completionTokens: 2 } });

    const result = await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'how much work did we do' });

    expect(providerCall).toHaveBeenCalledTimes(1);
    expect(result.route).toBe('L1');
    expect(result.reply).not.toMatch(/do not have access/);
    providerCall.mockReset();
  });
});

/**
 * "Sorry, I did not catch that" was the reply to a request that WAS caught --
 * production, 2026-09-15. When the model picks a write and misses an argument,
 * the person is told what is missing.
 */
describe('a write understood but not filled in says what it still needs', () => {
  it('names the missing argument instead of claiming not to understand', async () => {
    const result = await ask({ worker_name: 'parveen kumar' });

    expect(result.reply).not.toMatch(/did not catch that/);
    expect(result.reply).toMatch(/still need: day/);
    expect(result.pendingConfirmation).toBeUndefined();
  });
});

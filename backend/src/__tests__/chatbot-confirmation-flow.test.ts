import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { z } from 'zod';

let sessionState: Record<string, unknown> = {};
let toolCallLog = new Map<string, { id: string; status: string }>();
const conversationRow = () => ({
  id: 'conv_1',
  worker_id: 'mgr_1',
  status: 'IN_PROGRESS',
  turn_count: 2,
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
    // checkBudget sums the worker's own spend for the day from this table.
    aggregate: jest.fn(async () => ({ _sum: { tokens_input: 0, tokens_output: 0 } })) as any,
  },
  // A real (if tiny) tool-call log, so the idempotency guard is exercised
  // rather than mocked away. findPriorCall reads this; recordToolCall writes it.
  chatbotToolCall: {
    create: jest.fn(async ({ data }: any) => {
      if (toolCallLog.has(data.idempotency_key)) {
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
      toolCallLog.set(data.idempotency_key, { id: 'tc_' + toolCallLog.size, status: data.status });
      return { id: 'tc_' + (toolCallLog.size - 1) };
    }) as any,
    findUnique: jest.fn(async ({ where }: any) => toolCallLog.get(where.idempotency_key) ?? null) as any,
    findFirst: jest.fn(async () => null) as any,
  },
  chatbotBudgetCounter: { findUnique: jest.fn(async () => null) as any, upsert: jest.fn(async () => ({})) as any },
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

const writeInvoke = jest.fn(async () => ({ created: 1 })) as any;

import { registerTool } from '../modules/chatbot/tools/registry.js';
import { runTurn } from '../modules/chatbot/orchestrator/orchestrator.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const TOOL = 'test.high_risk_write';
registerTool({
  name: TOOL,
  description: 'fixture: a high-risk write',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,
  interfaceRef: 'none (test fixture)',
  approvalRef: 'none (test fixture)',
  args: z.object({ room_number: z.string(), count: z.number() }).strict(),
  // A real token: assertValidRegistration refuses a null permission on
  // anything but a READ_ONLY self-scoped tool, which is correct -- the
  // `null` escape hatch must never widen to writes.
  permission: 'staffing:write',
  scopeCheck: 'self',
  invoke: writeInvoke,
  compress: (raw: unknown) => ({ summary: 'done', data: raw }),
  maxResultTokens: 50,
});

const ACTOR = { userId: 'mgr_1', role: 'manager', permissions: ['staffing:write'], scope: null } as unknown as ActorContext;

describe('high-risk write confirmation flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionState = {};
    toolCallLog = new Map();
    writeInvoke.mockResolvedValue({ created: 1 });
    providerCall.mockResolvedValue({
      text: '',
      toolUse: { name: TOOL, input: { room_number: '204', count: 1 } },
      usage: { promptTokens: 10, completionTokens: 2 },
    });
  });

  it('PROPOSES without writing anything', async () => {
    const result = await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'clean room 204' });
    expect(writeInvoke).not.toHaveBeenCalled();
    expect(result.pendingConfirmation).toBeDefined();
    expect(result.pendingConfirmation!.toolName).toBe(TOOL);
    // The summary must show the actual arguments, not a prose paraphrase.
    expect(result.pendingConfirmation!.summary).toContain('room_number: 204');
    expect(result.pendingConfirmation!.summary).toMatch(/Nothing has been changed yet/);
  });

  it('parks the call server-side, so a client has nothing to tamper with', async () => {
    await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'clean room 204' });
    const pending = (sessionState as any).pending_confirmation;
    expect(pending.tool_name).toBe(TOOL);
    expect(pending.args).toEqual({ room_number: '204', count: 1 });
  });

  it('executes once, and only once, when the token comes back', async () => {
    const proposal = await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'clean room 204' });
    const token = proposal.pendingConfirmation!.token;

    const done = await runTurn({ conversationId: 'conv_1', actor: ACTOR, confirmToken: token });
    expect(writeInvoke).toHaveBeenCalledTimes(1);
    expect(done.toolInvoked).toBe(TOOL);

    // Replay: the pending call was cleared, so the same token does nothing.
    const replay = await runTurn({ conversationId: 'conv_1', actor: ACTOR, confirmToken: token });
    expect(writeInvoke).toHaveBeenCalledTimes(1);
    expect(replay.reply).toMatch(/nothing waiting to be confirmed/i);
  });

  it("refuses another user's token, and writes nothing", async () => {
    // Two independent layers stop this, and the OUTER one fires first:
    // RULE-CHAT-09 binds a conversation to the worker who started it, so
    // mgr_2 is refused before the token is even examined. The token's actor
    // binding (covered directly in chatbot-confirm-token.test.ts) is the
    // second layer, and would catch a token replayed into a conversation the
    // attacker legitimately owns.
    const proposal = await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'clean room 204' });
    const other = { ...ACTOR, userId: 'mgr_2' } as unknown as ActorContext;
    const result = await runTurn({ conversationId: 'conv_1', actor: other, confirmToken: proposal.pendingConfirmation!.token });
    expect(writeInvoke).not.toHaveBeenCalled();
    expect(result.reply).toMatch(/do not have access/i);
    // And the pending call is still parked, untouched by the failed attempt.
    expect((sessionState as any).pending_confirmation).toBeDefined();
  });

  it('refuses a forged token and writes nothing', async () => {
    await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'clean room 204' });
    const result = await runTurn({ conversationId: 'conv_1', actor: ACTOR, confirmToken: 'forged.token' });
    expect(writeInvoke).not.toHaveBeenCalled();
    expect(result.reply).toMatch(/could not be verified/i);
  });

  it('never leaks WHY a confirmation failed', async () => {
    await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'clean room 204' });
    const result = await runTurn({ conversationId: 'conv_1', actor: ACTOR, confirmToken: 'forged.token' });
    // A message naming the failed claim would be an oracle.
    for (const leak of ['signature', 'actor', 'hash', 'CLAIM_MISMATCH', 'BAD_SIGNATURE']) {
      expect(result.reply).not.toContain(leak);
    }
  });

  it('does not park a proposal whose arguments the tool would reject', async () => {
    // Showing a summary built from unvalidated model output would have the
    // user approving a call that could never run.
    providerCall.mockResolvedValue({
      text: '',
      toolUse: { name: TOOL, input: { room_number: '204' } }, // missing `count`
      usage: { promptTokens: 5, completionTokens: 1 },
    });
    const result = await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'x' });
    expect(result.pendingConfirmation).toBeUndefined();
    expect((sessionState as any).pending_confirmation).toBeUndefined();
    expect(writeInvoke).not.toHaveBeenCalled();
  });

  it('REGRESSION: a re-parked identical call does not execute a second time', async () => {
    // Found in review. The confirm path originally had no idempotency guard,
    // so clearing the pending row was the ONLY thing stopping a double
    // execution -- and that is a read-then-write, which two concurrent
    // confirmations both pass. The unique constraint on idempotency_key
    // would then stop only the second LOG row, after the second write had
    // already happened. Here the pending call is deliberately restored, as a
    // racing request would still see it.
    const first = await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'clean room 204' });
    const token = first.pendingConfirmation!.token;
    const parked = (sessionState as any).pending_confirmation;

    await runTurn({ conversationId: 'conv_1', actor: ACTOR, confirmToken: token });
    expect(writeInvoke).toHaveBeenCalledTimes(1);

    // Simulate the racing confirmation: pending is still present.
    (sessionState as any).pending_confirmation = parked;
    const second = await runTurn({ conversationId: 'conv_1', actor: ACTOR, confirmToken: token });

    expect(writeInvoke).toHaveBeenCalledTimes(1);
    expect(second.reply).toMatch(/already done/i);
  });

  it('REGRESSION: a confirmed write that THROWS still leaves an audit row', async () => {
    // Found in review. executeTool deliberately lets invoke() errors
    // propagate, so recordToolCall was never reached -- a high-risk write
    // the user explicitly approved could fail leaving no record at all. The
    // handoff is explicit that "this was denied" carries at least as much
    // audit value as "this succeeded"; a throw was a third outcome nobody
    // recorded.
    const proposal = await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'clean room 204' });
    writeInvoke.mockRejectedValueOnce(new Error('database exploded'));

    await expect(
      runTurn({ conversationId: 'conv_1', actor: ACTOR, confirmToken: proposal.pendingConfirmation!.token })
    ).rejects.toThrow('database exploded');

    // The attempt is on record...
    expect(mockPrisma.chatbotToolCall.create).toHaveBeenCalled();
    const recorded = (mockPrisma.chatbotToolCall.create as any).mock.calls.at(-1)[0].data;
    expect(recorded.tool_name).toBe(TOOL);
    expect(recorded.confirmed).toBe(true);
    expect(recorded.denial_reason).toBe('EXECUTION_FAILED');

    // ...and the error still reaches the caller. Nothing is swallowed.
  });

  it('a failed write does not leave a replayable confirmation', async () => {
    // Pending is cleared BEFORE execution precisely so a mid-write failure
    // cannot leave a token that still works.
    const proposal = await runTurn({ conversationId: 'conv_1', actor: ACTOR, text: 'clean room 204' });
    writeInvoke.mockRejectedValueOnce(new Error('boom'));
    await expect(
      runTurn({ conversationId: 'conv_1', actor: ACTOR, confirmToken: proposal.pendingConfirmation!.token })
    ).rejects.toThrow();
    expect((sessionState as any).pending_confirmation).toBeUndefined();
  });

  it('confirming with nothing pending is a no-op, not an error', async () => {
    const result = await runTurn({ conversationId: 'conv_1', actor: ACTOR, confirmToken: 'anything' });
    expect(writeInvoke).not.toHaveBeenCalled();
    expect(result.reply).toMatch(/nothing waiting/i);
  });
});

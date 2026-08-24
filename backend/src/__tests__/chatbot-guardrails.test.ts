import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Guardrails: budget enforcement (REQ-CHAT-004/005, OD-CHAT-010) and egress
 * redaction (CRR §27 special-category handling).
 */

let counterRow: { tokens_spent: number } | null = null;
let dailySum = { tokens_input: 0, tokens_output: 0 };
let lastUpsert: any = null;

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
    CHATBOT_MONTHLY_TOKEN_CAP: 1000,
    CHATBOT_CONVERSATION_TOKEN_CAP: 100,
    CHATBOT_USER_DAILY_TOKEN_CAP: 500,
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    chatbotBudgetCounter: {
      findUnique: async () => counterRow,
      upsert: async (arg: any) => {
        lastUpsert = arg;
        return {};
      },
    },
    chatbotConversation: {
      aggregate: async () => ({ _sum: dailySum }),
    },
  }),
}));

import { checkBudget, recordSpend, currentYearMonth } from '../modules/chatbot/guardrails/budget.js';
import { redact, isSensitiveField } from '../modules/chatbot/guardrails/redaction.js';

beforeEach(() => {
  counterRow = null;
  dailySum = { tokens_input: 0, tokens_output: 0 };
  lastUpsert = null;
});

describe('budget guard', () => {
  it('allows a turn when every cap has headroom', async () => {
    const d = await checkBudget({ workerId: 'w1', conversationTokensSpent: 10 });
    expect(d.allowed).toBe(true);
  });

  it('denies once the per-conversation cap is reached (REQ-CHAT-005)', async () => {
    const d = await checkBudget({ workerId: 'w1', conversationTokensSpent: 100 });
    expect(d).toEqual({ allowed: false, reason: 'conversation-cap-exhausted' });
  });

  it('denies once the hard monthly cap is reached (REQ-CHAT-004)', async () => {
    counterRow = { tokens_spent: 1000 };
    const d = await checkBudget({ workerId: 'w1', conversationTokensSpent: 0 });
    expect(d).toEqual({ allowed: false, reason: 'monthly-cap-exhausted' });
  });

  it('denies once one worker exhausts their daily share (OD-CHAT-010)', async () => {
    // The named abuse shape: many conversations, each individually under the
    // per-conversation cap, collectively draining the shared monthly budget.
    dailySum = { tokens_input: 400, tokens_output: 100 };
    const d = await checkBudget({ workerId: 'w1', conversationTokensSpent: 0 });
    expect(d).toEqual({ allowed: false, reason: 'daily-user-cap-exhausted' });
  });

  it('records spend as an atomic increment, not read-modify-write', async () => {
    await recordSpend({ promptTokens: 30, completionTokens: 12 });
    expect(lastUpsert.where).toEqual({ year_month: currentYearMonth() });
    expect(lastUpsert.update).toEqual({ tokens_spent: { increment: 42 } });
    expect(lastUpsert.create.tokens_spent).toBe(42);
  });

  it('does not write a counter row for a zero-cost turn', async () => {
    await recordSpend({ promptTokens: 0, completionTokens: 0 });
    expect(lastUpsert).toBeNull();
  });
});

describe('egress redaction (CRR §27)', () => {
  it.each([
    'tax_number',
    'social_security_number',
    'sozialversicherungsnummer',
    'iban',
    'passport_number',
    'konfession',
    'date_of_birth',
    'health_notes',
  ])('treats %s as sensitive', (field) => {
    expect(isSensitiveField(field)).toBe(true);
  });

  it.each(['id', 'status', 'day', 'hotel_id', 'worker_id'])('leaves %s alone', (field) => {
    expect(isSensitiveField(field)).toBe(false);
  });

  it('replaces a sensitive value with a presence boolean, never the content', () => {
    const out = redact({
      id: 'a1',
      tax_number: '12 345 678 901',
      status: 'CONFIRMED',
    }) as Record<string, unknown>;

    expect(out).toEqual({ id: 'a1', has_tax_number: true, status: 'CONFIRMED' });
    expect(JSON.stringify(out)).not.toContain('12 345');
  });

  it('reports absence as false rather than dropping the field', () => {
    const out = redact({ iban: null }) as Record<string, unknown>;
    expect(out).toEqual({ has_iban: false });
  });

  it('redacts inside nested structures and arrays', () => {
    const out = redact({
      rows: [{ id: 'x', social_security_number: 'AB123' }],
    });
    expect(JSON.stringify(out)).not.toContain('AB123');
    expect(JSON.stringify(out)).toContain('has_social_security_number');
  });

  it('is depth-bounded so a deep structure cannot hang a turn', () => {
    let deep: any = { iban: 'DE123' };
    for (let i = 0; i < 30; i += 1) deep = { nested: deep };
    expect(() => redact(deep)).not.toThrow();
  });
});

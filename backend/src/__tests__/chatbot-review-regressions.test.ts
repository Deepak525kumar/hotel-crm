import { describe, it, expect, jest } from '@jest/globals';

/**
 * REGRESSIONS FOUND IN REVIEW, not by the suite.
 *
 * Both defects below shipped green: every existing test passed, tsc was
 * clean, and CI was green on the pull request. They were found by tracing the
 * changed code through its callers rather than by running it, which is the
 * argument for doing that at all.
 *
 * Each one is pinned here so the specific mistake cannot come back.
 */

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    warn: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    debug: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    error: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
  },
}));

const created = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({ chatbotToolCall: { create: created } }),
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'test' }),
  loadEnv: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
}));

import { recordToolCall } from '../modules/chatbot/tools/tool-call-log.js';
import { toolError } from '../modules/chatbot/tools/tool-errors.js';
import { todayIso } from '../modules/chatbot/tools/definitions/daily-operations.tools.js';
import { todayInCalendarTimezone, CALENDAR_TIMEZONE } from '../lib/utils.js';

/**
 * DEFECT 1 — a tool failure was audited as a reasonless denial.
 *
 * Classifying errors inside the executor turned a thrown service error into a
 * FAILED outcome. `recordToolCall` knew only SUCCESS and DENIED, so a FAILED
 * call was written as `status: 'DENIED'` with `denial_reason: null` and
 * `duration_ms: null`.
 *
 * The audit row existed, which is why nothing failed. It just said a call was
 * denied and refused to say why -- making a database outage indistinguishable
 * from a permission refusal to anyone reading the log afterwards. The column
 * had documented a FAILED state all along; the code had never produced one.
 */
describe('a failed tool call is audited as FAILED, with a reason', () => {
  const call = (outcome: Parameters<typeof recordToolCall>[0]['outcome']) => {
    created.mockReset();
    created.mockResolvedValue({ id: 'row1' });
    return recordToolCall({
      conversationId: 'c1',
      turnIndex: 0,
      toolName: 'test.tool',
      tier: 'READ_ONLY',
      args: {},
      confirmed: false,
      outcome,
    });
  };

  it('records FAILED distinctly from DENIED', async () => {
    await call({ status: 'FAILED', error: toolError('CONFLICT', 'Already checked in'), durationMs: 12 });
    expect(created.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('records the error CODE rather than nothing', async () => {
    await call({ status: 'FAILED', error: toolError('TEMPORARY', 'timeout'), durationMs: 40 });
    // The fact an investigation actually needs. `null` here was the defect.
    expect(created.mock.calls[0][0].data.denial_reason).toBe('TEMPORARY');
  });

  it('keeps the duration, which separates a timeout from an instant refusal', async () => {
    await call({ status: 'FAILED', error: toolError('TEMPORARY', 'timeout'), durationMs: 19_998 });
    expect(created.mock.calls[0][0].data.duration_ms).toBe(19_998);
  });

  it('still records a gate denial as DENIED with its denial code', async () => {
    // The pre-existing behaviour must be untouched.
    await call({ status: 'DENIED', reason: 'no', denialCode: 'MISSING_PERMISSION' as never });
    const data = created.mock.calls[0][0].data;
    expect({ status: data.status, reason: data.denial_reason }).toEqual({
      status: 'DENIED',
      reason: 'MISSING_PERMISSION',
    });
  });

  it('still records success with its duration and no reason', async () => {
    await call({
      status: 'SUCCESS',
      result: { summary: 'ok', data: null },
      durationMs: 7,
    });
    const data = created.mock.calls[0][0].data;
    expect({ status: data.status, reason: data.denial_reason, ms: data.duration_ms }).toEqual({
      status: 'SUCCESS',
      reason: null,
      ms: 7,
    });
  });
});

/**
 * DEFECT 2 — the shift tools resolved the wrong DAY after midnight.
 *
 * `todayIso()` sliced `toISOString()`, which is UTC. The platform's calendar
 * day is Europe/Berlin. At 00:30 Berlin it is still 22:30 UTC the previous
 * day, so `attendance.check_in`, `rooms.log_cleaned` and `rooms.my_rooms` all
 * resolved YESTERDAY's shift.
 *
 * Nothing errored. A night-shift worker clocking in just after midnight would
 * have been checked in against the wrong day and their rooms logged against
 * it -- a plausible wrong answer, for exactly the population these tools were
 * built for. `utils.ts` already had the correct helper.
 */
describe('the shift tools use the platform calendar day, not UTC', () => {
  it('agrees with the platform helper for the current instant', () => {
    expect(todayIso()).toBe(todayInCalendarTimezone());
  });

  /**
   * THE DETERMINISTIC GUARD. The assertion above only detects the defect
   * during the two hours a day when UTC and Berlin differ -- it would have
   * passed 22 hours out of 24 with the bug still present. Pinning a fixed
   * instant is what makes this a guard rather than a coin flip.
   */
  it('names the Berlin day at 00:30 Berlin, not the UTC day before it', () => {
    // 22:30 UTC on the 8th is 00:30 Berlin on the 9th (CEST, UTC+2).
    expect(todayIso(new Date('2026-09-08T22:30:00.000Z'))).toBe('2026-09-09');
  });

  it('handles the winter offset too, where Berlin is UTC+1', () => {
    // 23:30 UTC on 8 Jan is 00:30 Berlin on the 9th (CET, UTC+1).
    expect(todayIso(new Date('2026-01-08T23:30:00.000Z'))).toBe('2026-01-09');
    // ...and 22:30 UTC is still the 8th in winter, unlike in summer.
    expect(todayIso(new Date('2026-01-08T22:30:00.000Z'))).toBe('2026-01-08');
  });

  it('is the Europe/Berlin day, which is what the rest of the platform means', () => {
    expect(CALENDAR_TIMEZONE).toBe('Europe/Berlin');
    expect(todayIso()).toBe(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())
    );
  });

  /**
   * The exact moment the old code was wrong, pinned as arithmetic so the bug
   * is legible without waiting for 00:30 to run the suite.
   */
  it('would have named the previous day just after midnight, under the old UTC slice', () => {
    // 22:30 UTC on the 8th is 00:30 Berlin on the 9th (CEST, UTC+2).
    const justAfterMidnightBerlin = new Date('2026-09-08T22:30:00.000Z');

    const oldBehaviour = justAfterMidnightBerlin.toISOString().slice(0, 10);
    const correct = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(
      justAfterMidnightBerlin
    );

    expect(oldBehaviour).toBe('2026-09-08');
    expect(correct).toBe('2026-09-09');
    // A whole day apart, silently.
    expect(oldBehaviour).not.toBe(correct);
  });

  it('still agrees with UTC at midday, so the fix did not shift the common case', () => {
    const midday = new Date('2026-09-08T12:00:00.000Z');
    expect(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(midday)
    ).toBe(midday.toISOString().slice(0, 10));
  });
});

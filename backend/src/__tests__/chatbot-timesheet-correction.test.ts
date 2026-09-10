import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * `attendance.correct_times` — the capability held back until 2026-09-10, and
 * the only chatbot tool that changes what somebody is PAID.
 *
 * It was deferred on the grounds that manager timesheet editing is the
 * platform's most fraud-sensitive write. Building it did not make that
 * concern go away; it made it something to design against, and these tests
 * are that design stated as assertions:
 *
 *   - It sets CLOCK TIMES only. `minutes_worked` is a direct write of paid
 *     time derived from nothing, and this tool cannot reach it.
 *   - It cannot sign a timesheet off (`is_verified`).
 *   - Every correction carries a REASON into the record, so a dispute is
 *     argued from the timesheet rather than from memory.
 *   - The record is found from the roster; no attendance id is expressible.
 */

const mockAttendanceList = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockAttendanceUpdate = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/attendance/service.js', () => ({
  attendanceService: { list: mockAttendanceList, update: mockAttendanceUpdate },
}));
jest.mock('../modules/calendar/service.js', () => ({ calendarService: {} }));
jest.mock('../modules/job-requests/service.js', () => ({ jobRequestService: {} }));
jest.mock('../modules/users/service.js', () => ({ userService: {} }));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveHotelReference: jest.fn(async () => ({ status: 'RESOLVED', hotelId: 'h1', name: 'Hotel Adler' })) as any,
  resolveWorkerReference: jest.fn(async () => ({ status: 'RESOLVED', workerId: 'w1', fullName: 'Anna Braun' })) as any,
  refuseUnresolved: () => ({ refused: { code: 'NOT_FOUND', message: 'no worker', nextAction: 'ask_user' } }),
  refuseUnresolvedHotel: () => ({ refused: { code: 'NOT_FOUND', message: 'no hotel', nextAction: 'ask_user' } }),
  describeUnresolved: () => 'no',
}));

import { correctTimes, berlinInstant } from '../modules/chatbot/tools/definitions/planning.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const manager = (): ActorContext =>
  ({
    userId: 'm1',
    role: 'manager',
    permissions: ROLE_PERMISSIONS.MANAGER ?? [],
    scope: { hotel_group_id: 'g1' },
  }) as unknown as ActorContext;

const VALID = {
  worker_name: 'Anna',
  day: '2026-09-09',
  check_out: '16:30',
  reason: 'forgot to clock out',
};

const summaryOf = (raw: unknown) => correctTimes.compress?.(raw).summary ?? '';
const codeOf = (raw: unknown) =>
  (correctTimes.compress?.(raw).data as { refusal_code?: string } | null)?.refusal_code;

beforeEach(() => {
  jest.clearAllMocks();
  mockAttendanceList.mockResolvedValue({ data: [{ id: 'att1' }], total: 1 });
  mockAttendanceUpdate.mockResolvedValue({
    check_in_at: '2026-09-09T06:00:00.000Z',
    check_out_at: '2026-09-09T14:30:00.000Z',
    minutes_worked: 510,
  });
});

describe('what it cannot do — the reason it was safe to build', () => {
  /**
   * THE MOST IMPORTANT TEST IN THE FILE. `minutes_worked` is paid time
   * written directly: whoever sets it decides what a shift was worth, with
   * nothing to check it against. The service accepts it from a manager; this
   * tool cannot express it.
   */
  it.each(['minutes_worked', 'minutes_late', 'is_verified', 'status'])(
    'refuses %s outright',
    (field) => {
      expect(correctTimes.args.safeParse({ ...VALID, [field]: 1 }).success).toBe(false);
    }
  );

  it('never sends minutes or a verification flag to the service', async () => {
    await correctTimes.invoke(VALID as never, manager());

    const [, input] = mockAttendanceUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(input).not.toHaveProperty('minutes_worked');
    expect(input).not.toHaveProperty('minutes_late');
    expect(input).not.toHaveProperty('is_verified');
    expect(input).not.toHaveProperty('status');
  });

  it('expresses no attendance id — the record comes from the roster', () => {
    for (const bad of [{ attendance_id: 'att1' }, { worker_id: 'w1' }, { id: 'att1' }]) {
      expect(correctTimes.args.safeParse({ ...VALID, ...bad }).success).toBe(false);
    }
  });

  it('is out of every worker\'s reach', () => {
    for (const role of ['WORKER', 'CHECKER'] as const) {
      const actor = { role: role.toLowerCase(), permissions: ROLE_PERMISSIONS[role] } as never;
      expect({ role, reachable: actorHasPermission(actor, correctTimes.permission!) }).toEqual({
        role,
        reachable: false,
      });
    }
    expect(actorHasPermission(manager() as never, correctTimes.permission!)).toBe(true);
  });

  it('is confirmed before it runs', () => {
    expect({ tier: correctTimes.tier, confirm: correctTimes.confirm }).toEqual({
      tier: 'HIGH_RISK_WRITE',
      confirm: true,
    });
  });
});

describe('a reason is not optional', () => {
  /**
   * The HTTP route treats notes as optional. Here it is mandatory: a change
   * to paid time with no stated cause is what an audit cannot evaluate later,
   * and this is the one path where the person making the change is not
   * looking at the timesheet while they do it.
   */
  it('rejects a correction with no reason', () => {
    const { reason: _omitted, ...withoutReason } = VALID;
    expect(correctTimes.args.safeParse(withoutReason).success).toBe(false);
    expect(correctTimes.args.safeParse({ ...VALID, reason: '  ' }).success).toBe(false);
  });

  it('writes the reason into the record, marked as assistant-made', async () => {
    await correctTimes.invoke(VALID as never, manager());

    const [, input] = mockAttendanceUpdate.mock.calls[0] as [string, { notes?: string }];
    expect(input.notes).toMatch(/assistant/i);
    expect(input.notes).toContain('forgot to clock out');
  });
});

describe('the times it writes', () => {
  it('requires at least one time', () => {
    const { check_out: _o, ...noTimes } = VALID;
    expect(correctTimes.args.safeParse(noTimes).success).toBe(false);
    expect(correctTimes.args.safeParse({ ...VALID, check_in: '07:00' }).success).toBe(true);
  });

  it('rejects a malformed clock time', () => {
    for (const bad of ['25:00', '7am', '16:60', '1630']) {
      expect(correctTimes.args.safeParse({ ...VALID, check_out: bad }).success).toBe(false);
    }
  });

  it('sends only the time that was given', async () => {
    await correctTimes.invoke(VALID as never, manager());
    const [, input] = mockAttendanceUpdate.mock.calls[0] as [string, Record<string, unknown>];

    expect(input).toHaveProperty('check_out_at');
    expect(input).not.toHaveProperty('check_in_at');
  });

  it('refuses when there is no record for that day, writing nothing', async () => {
    mockAttendanceList.mockResolvedValue({ data: [], total: 0 });
    const out = await correctTimes.invoke(VALID as never, manager());

    expect(mockAttendanceUpdate).not.toHaveBeenCalled();
    expect(codeOf(out)).toBe('NOT_FOUND');
  });

  /** Two shifts in a day is a real state, and picking one for them would guess. */
  it('refuses rather than choose between two records on the same day', async () => {
    mockAttendanceList.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], total: 2 });
    const out = await correctTimes.invoke(VALID as never, manager());

    expect(mockAttendanceUpdate).not.toHaveBeenCalled();
    expect(codeOf(out)).toBe('AMBIGUOUS');
  });

  it('reports the corrected times and the hours they come to', async () => {
    expect(summaryOf(await correctTimes.invoke(VALID as never, manager()))).toMatch(
      /Anna Braun.*2026-09-09.*8\.5 hours/
    );
  });
});

/**
 * "She left at 16:30" means half four in Frankfurt. Treating it as UTC would
 * store an instant one or two hours out depending on the season, and that
 * error lands directly in paid minutes — the one place on this platform where
 * being an hour wrong is not cosmetic.
 */
describe('berlinInstant — wall-clock time in the right zone', () => {
  it('reads a summer time as CEST (UTC+2)', () => {
    // 2026-07-01 is inside CEST.
    expect(berlinInstant('2026-07-01', '16:30').toISOString()).toBe('2026-07-01T14:30:00.000Z');
  });

  it('reads a winter time as CET (UTC+1)', () => {
    expect(berlinInstant('2026-01-15', '16:30').toISOString()).toBe('2026-01-15T15:30:00.000Z');
  });

  /**
   * The offset is derived from the zone at that instant rather than assumed,
   * so it is correct on both sides of the changeover rather than only in the
   * half of the year somebody happened to test in.
   */
  it('is correct on both sides of the autumn changeover', () => {
    // Europe/Berlin returns to CET on the last Sunday of October 2026 (25th).
    expect(berlinInstant('2026-10-24', '12:00').toISOString()).toBe('2026-10-24T10:00:00.000Z');
    expect(berlinInstant('2026-10-26', '12:00').toISOString()).toBe('2026-10-26T11:00:00.000Z');
  });

  it('keeps midnight on the day it was given', () => {
    expect(berlinInstant('2026-07-01', '00:00').toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });
});

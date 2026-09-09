import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Two capabilities that were MISSING, both found by probing the assistant
 * with the words ordinary people use rather than clean test phrasings
 * (2026-09-10, `scripts/chatbot-robustness-check.ts`).
 *
 * Neither gap looked like a gap from inside the code. Both looked like the
 * model being stupid, and neither could have been fixed by tuning a
 * description:
 *
 *   "who called in sick"          -> calendar.mark_worker_absence
 *                                    {worker_name: "Anna", kind: "SICK"}
 *
 * A question about who is off selected the tool that RECORDS someone as off,
 * against a worker it invented. The registry had exactly one absence-shaped
 * tool and it was a write, so a read question had nowhere correct to go.
 *
 *   "how many hours did i do this week" -> analytics.my_stats
 *
 * Which returns completed shifts, rooms cleaned and a rating -- and no hours.
 * `WorkerStats` has no hours field, so the worker was answered confidently
 * about something they had not asked.
 */

const mockListAbsences = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockAttendanceList = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/calendar/service.js', () => ({
  calendarService: { listAbsences: mockListAbsences },
}));
jest.mock('../modules/attendance/service.js', () => ({
  attendanceService: { list: mockAttendanceList },
}));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveHotelReference: jest.fn(async () => ({ status: 'RESOLVED', hotelId: 'h1', name: 'Hotel Adler' })) as any,
  resolveWorkerReference: jest.fn(async () => ({ status: 'RESOLVED', workerId: 'w1', fullName: 'Anna Braun' })) as any,
  refuseUnresolved: () => ({ refused: { code: 'NOT_FOUND', message: 'no', nextAction: 'ask_user' } }),
  refuseUnresolvedHotel: () => ({ refused: { code: 'NOT_FOUND', message: 'no hotel', nextAction: 'ask_user' } }),
  describeUnresolved: () => 'no',
}));

import { teamAbsences } from '../modules/chatbot/tools/definitions/planning.tools.js';
import { myHours } from '../modules/chatbot/tools/definitions/daily-operations.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const manager = (): ActorContext =>
  ({ userId: 'm1', role: 'manager', permissions: ROLE_PERMISSIONS.MANAGER ?? [], scope: { hotel_group_id: 'g1' } }) as unknown as ActorContext;
const worker = (): ActorContext =>
  ({ userId: 'w1', role: 'worker', permissions: ROLE_PERMISSIONS.WORKER ?? [], scope: null }) as unknown as ActorContext;

const summaryOf = (tool: { compress?: (r: unknown) => { summary: string } }, raw: unknown) =>
  tool.compress?.(raw).summary ?? '';

beforeEach(() => {
  jest.clearAllMocks();
  mockListAbsences.mockResolvedValue([]);
  mockAttendanceList.mockResolvedValue({ data: [], total: 0 });
});

describe('calendar.team_absences — the read that was missing', () => {
  it('reads, and cannot write: READ_ONLY with no confirmation', () => {
    expect({ tier: teamAbsences.tier, confirm: teamAbsences.confirm }).toEqual({
      tier: 'READ_ONLY',
      confirm: false,
    });
  });

  it('is out of a worker\'s reach -- other people\'s absence is not their business', () => {
    expect(actorHasPermission(worker() as never, teamAbsences.permission!)).toBe(false);
    expect(actorHasPermission(manager() as never, teamAbsences.permission!)).toBe(true);
  });

  it('accepts no worker id, and no name it could invent', () => {
    for (const bad of [{ worker_id: 'w2' }, { worker_name: 'Anna' }, { hotel_id: 'h1' }]) {
      expect(teamAbsences.args.safeParse(bad).success).toBe(false);
    }
  });

  it('defaults to today when no period is given', async () => {
    await teamAbsences.invoke({} as never, manager());
    const [query] = mockListAbsences.mock.calls[0] as [Record<string, unknown>];
    expect(query.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query.from).toEqual(query.to);
  });

  it('passes a period straight through', async () => {
    await teamAbsences.invoke({ from: '2026-09-07', to: '2026-09-13' } as never, manager());
    const [query] = mockListAbsences.mock.calls[0] as [Record<string, unknown>];
    expect(query).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('names who is off and whether it is sickness or holiday', async () => {
    mockListAbsences.mockResolvedValue([
      { worker_name: 'Anna Braun', kind: 'SICK', day: '2026-09-09' },
      { worker_name: 'Tomasz Nowak', kind: 'VACATION', day: '2026-09-09' },
    ]);

    const summary = summaryOf(teamAbsences, await teamAbsences.invoke({} as never, manager()));
    expect(summary).toMatch(/Anna Braun \(sick\)/);
    expect(summary).toMatch(/Tomasz Nowak \(holiday\)/);
  });

  /** Why somebody is off is their business, and a sickness reason is health data. */
  it('never discloses the REASON for an absence', async () => {
    mockListAbsences.mockResolvedValue([
      { worker_name: 'Anna Braun', kind: 'SICK', day: '2026-09-09', reason: 'chemotherapy' },
    ]);

    const out = await teamAbsences.invoke({} as never, manager());
    expect(summaryOf(teamAbsences, out)).not.toMatch(/chemotherapy/i);
    expect(JSON.stringify(teamAbsences.compress!(out).data)).not.toMatch(/chemotherapy/i);
  });

  it('says so plainly when nobody is off', async () => {
    expect(summaryOf(teamAbsences, await teamAbsences.invoke({} as never, manager()))).toMatch(
      /Nobody on your team is recorded as off/i
    );
  });
});

describe('attendance.my_hours — hours, which nothing reported', () => {
  it('sums the caller\'s own recorded minutes into hours', async () => {
    mockAttendanceList.mockResolvedValue({
      data: [{ minutes_worked: 450 }, { minutes_worked: 480 }],
      total: 2,
    });

    const summary = summaryOf(
      myHours,
      await myHours.invoke({ from: '2026-09-07', to: '2026-09-13' } as never, worker())
    );
    // 930 minutes = 15.5 hours, said the way a person says it.
    expect(summary).toMatch(/15\.5 hours across 2 shifts/);
  });

  it('asks the service for the caller\'s own rows over the given period', async () => {
    await myHours.invoke({ from: '2026-09-07', to: '2026-09-13' } as never, worker());
    const [query] = mockAttendanceList.mock.calls[0] as [Record<string, unknown>];
    expect({ from: query.from, to: query.to }).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    // No worker id: "mine" is resolved from the actor, never an argument.
    expect(JSON.stringify(query)).not.toMatch(/worker_id/);
  });

  /**
   * A shift still in progress has no minutes. Counting it as a zero-hour
   * shift would understate nothing but would claim a shift that has not
   * finished, so it is excluded and reported separately.
   */
  it('excludes shifts not clocked out yet, and says how many', async () => {
    mockAttendanceList.mockResolvedValue({
      data: [{ minutes_worked: 480 }, { minutes_worked: null }],
      total: 2,
    });

    const summary = summaryOf(myHours, await myHours.invoke({} as never, worker()));
    expect(summary).toMatch(/8 hours across 1 shift/);
    expect(summary).toMatch(/1 shift is not clocked out yet/);
  });

  it('says there are no hours yet rather than reporting zero', async () => {
    expect(summaryOf(myHours, await myHours.invoke({} as never, worker()))).toMatch(
      /no hours are recorded yet/i
    );
  });

  it('is reachable by a real worker, which is the whole point', () => {
    // permission is null (the route enforces none); reachability is the test.
    expect(myHours.permission).toBeNull();
    expect({ tier: myHours.tier, scope: myHours.scopeCheck }).toEqual({
      tier: 'READ_ONLY',
      scope: 'self',
    });
  });

  it('rejects a half-open period, matching the owning schema', () => {
    expect(myHours.args.safeParse({ from: '2026-09-07' }).success).toBe(false);
    expect(myHours.args.safeParse({ from: '2026-09-07', to: '2026-09-13' }).success).toBe(true);
    expect(myHours.args.safeParse({}).success).toBe(true);
  });
});

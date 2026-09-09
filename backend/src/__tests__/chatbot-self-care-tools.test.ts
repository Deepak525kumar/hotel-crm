import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Four gaps found by mapping the platform's routes against the registry:
 * finishing a shift, withdrawing a sick day, asking for a payslip, and asking
 * how you are doing.
 *
 * The properties under test are the ones that make a self-scoped write safe:
 * no identifier is ever an argument, the record is resolved from the caller's
 * own data, and a state that has already moved past the ask is reported as
 * ALREADY_DONE rather than retried.
 */

const mockUpdate = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockList = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockOwnAbsences = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockDeleteAbsence = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockRequestPayslip = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockWorkerStats = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/assignments/service.js', () => ({
  assignmentService: { update: mockUpdate, list: mockList },
}));
jest.mock('../modules/calendar/service.js', () => ({
  calendarService: { getOwnAbsences: mockOwnAbsences, deleteAbsence: mockDeleteAbsence },
}));
jest.mock('../modules/hr/service.js', () => ({
  hrService: { requestPayslip: mockRequestPayslip },
}));
jest.mock('../modules/analytics/service.js', () => ({
  analyticsService: { getWorkerStats: mockWorkerStats },
}));

import {
  completeMyShift,
  withdrawMyAbsence,
  requestMyPayslip,
  myStats,
} from '../modules/chatbot/tools/definitions/self-care.tools.js';
import { todayIso } from '../modules/chatbot/tools/definitions/daily-operations.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const worker = (): ActorContext =>
  ({
    userId: 'w1',
    role: 'worker',
    permissions: ROLE_PERMISSIONS.WORKER ?? [],
    scope: null,
  }) as unknown as ActorContext;

const TODAY = todayIso();
const summaryOf = (tool: { compress?: (r: unknown) => { summary: string } }, raw: unknown) =>
  tool.compress?.(raw).summary ?? '';
const codeOf = (tool: { compress?: (r: unknown) => { data: unknown } }, raw: unknown) =>
  (tool.compress?.(raw).data as { refusal_code?: string } | null)?.refusal_code;

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({
    data: [{ id: 'a1', day: TODAY, status: 'IN_PROGRESS' }],
    total: 1,
  });
  mockUpdate.mockResolvedValue({ status: 'COMPLETED' });
  mockOwnAbsences.mockResolvedValue([{ id: 'ab1', day: '2026-09-20', kind: 'SICK' }]);
  mockDeleteAbsence.mockResolvedValue(undefined);
  mockRequestPayslip.mockResolvedValue({ status: 'PENDING' });
  mockWorkerStats.mockResolvedValue({ completed_shifts: 12, average_rating: 4.6 });
});

describe('no identifier is ever an argument', () => {
  it.each([
    ['assignments.complete_my_shift', () => completeMyShift],
    ['calendar.withdraw_my_absence', () => withdrawMyAbsence],
    ['hr.request_payslip', () => requestMyPayslip],
    ['analytics.my_stats', () => myStats],
  ])('%s refuses ids', (_name, get) => {
    const tool = get();
    for (const bad of [
      { assignment_id: 'a1' },
      { absence_id: 'ab1' },
      { worker_id: 'w2' },
      { userId: 'w2' },
    ]) {
      expect(tool.args.safeParse(bad).success).toBe(false);
    }
  });
});

describe('assignments.complete_my_shift', () => {
  it('closes the shift resolved from the roster, not one it was told about', async () => {
    await completeMyShift.invoke({} as never, worker());

    const [id, input, actorId] = mockUpdate.mock.calls[0] as [string, { status: string }, string];
    expect(id).toBe('a1');
    expect(input.status).toBe('COMPLETED');
    expect(actorId).toBe('w1');
  });

  /**
   * The token this tool exists to consume. It was added on 2026-09-09 with no
   * tool using it -- a permission that grants nothing to anything.
   */
  it('consumes the assignments:status-write token, which had no consumer before', () => {
    expect(completeMyShift.permission).toBe('assignments:status-write');
    expect(actorHasPermission(worker(), completeMyShift.permission!)).toBe(true);
  });

  it('reports an already-finished shift as ALREADY_DONE, not as a failure', async () => {
    mockUpdate.mockRejectedValue(new Error('Assignment is already COMPLETED'));

    const out = await completeMyShift.invoke({} as never, worker());
    // Re-running changes nothing, so the caller must stop rather than retry.
    expect(codeOf(completeMyShift, out)).toBe('ALREADY_DONE');
  });

  it('rethrows an unexpected failure instead of dressing it as a refusal', async () => {
    mockUpdate.mockRejectedValue(new Error('database unreachable'));
    await expect(completeMyShift.invoke({} as never, worker())).rejects.toThrow(/unreachable/i);
  });

  it('refuses when there is no shift today, writing nothing', async () => {
    mockList.mockResolvedValue({ data: [], total: 0 });
    const out = await completeMyShift.invoke({} as never, worker());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(codeOf(completeMyShift, out)).toBe('NOT_FOUND');
  });
});

describe('calendar.withdraw_my_absence', () => {
  it('resolves the absence from the caller\'s own records, by day', async () => {
    await withdrawMyAbsence.invoke({ day: '2026-09-20' } as never, worker());

    expect(mockOwnAbsences).toHaveBeenCalledWith('w1');
    const [absenceId] = mockDeleteAbsence.mock.calls[0] as [string];
    expect(absenceId).toBe('ab1'); // from the resolver, never from arguments
  });

  it('refuses a day the caller has no absence on', async () => {
    mockOwnAbsences.mockResolvedValue([]);
    const out = await withdrawMyAbsence.invoke({ day: '2026-09-20' } as never, worker());

    expect(mockDeleteAbsence).not.toHaveBeenCalled();
    // Somebody else's absence on that day is indistinguishable from none.
    expect(codeOf(withdrawMyAbsence, out)).toBe('NOT_FOUND');
  });

  /**
   * The service refuses withdrawing a PAST absence: the day happened, and
   * removing the record would rewrite history rather than change a plan.
   */
  it('reports a past absence as ALREADY_DONE rather than retrying', async () => {
    mockDeleteAbsence.mockRejectedValue(new Error('Cannot withdraw a past absence'));
    const out = await withdrawMyAbsence.invoke({ day: '2026-09-20' } as never, worker());
    expect(codeOf(withdrawMyAbsence, out)).toBe('ALREADY_DONE');
  });

  it('rejects an impossible date before touching anything', () => {
    expect(withdrawMyAbsence.args.safeParse({ day: '2026-02-30' }).success).toBe(false);
    expect(withdrawMyAbsence.args.safeParse({ day: '2026-09-20' }).success).toBe(true);
  });
});

describe('hr.request_payslip', () => {
  it('raises the request against the CALLER, never an argument', async () => {
    await requestMyPayslip.invoke({} as never, worker());

    const [payload] = mockRequestPayslip.mock.calls[0] as [Record<string, unknown>];
    expect(payload.worker_id).toBe('w1');
  });

  it('passes a note through when one is given, and omits it otherwise', async () => {
    await requestMyPayslip.invoke({ note: 'for August' } as never, worker());
    expect((mockRequestPayslip.mock.calls[0][0] as Record<string, unknown>).notes).toBe('for August');

    jest.clearAllMocks();
    mockRequestPayslip.mockResolvedValue({ status: 'PENDING' });
    await requestMyPayslip.invoke({} as never, worker());
    expect('notes' in (mockRequestPayslip.mock.calls[0][0] as object)).toBe(false);
  });

  it('is a low-risk write with no confirmation, because it discloses nothing', () => {
    // It raises a request a person actions; it produces no document and moves
    // no money.
    expect(requestMyPayslip.tier).toBe('LOW_RISK_WRITE');
    expect(requestMyPayslip.confirm).toBe(false);
  });

  it('is reachable by a real worker and checker, matching the route', () => {
    for (const role of ['WORKER', 'CHECKER'] as const) {
      const a = { ...worker(), role: role.toLowerCase(), permissions: ROLE_PERMISSIONS[role] } as never;
      expect(actorHasPermission(a, requestMyPayslip.permission!)).toBe(true);
    }
  });
});

describe('analytics.my_stats', () => {
  it('asks for the caller\'s own figures and nobody else\'s', async () => {
    await myStats.invoke({} as never, worker());
    expect(mockWorkerStats).toHaveBeenCalledWith('w1');
  });

  it('summarises whichever fields the service actually returns', async () => {
    expect(summaryOf(myStats, await myStats.invoke({} as never, worker())))
      .toMatch(/12 shifts completed/);
  });

  it('says so plainly when there are no figures yet', async () => {
    mockWorkerStats.mockResolvedValue({});
    expect(summaryOf(myStats, await myStats.invoke({} as never, worker())))
      .toMatch(/no statistics yet/i);
  });

  /**
   * The ONLY analytics tool, deliberately. The leaderboard and /stats routes
   * carry the OQ-ANALYTICS-01 authorization gap; wrapping one would
   * industrialise it. /my-stats does not ride their guard.
   */
  it('is the only analytics tool in the registry', async () => {
    const { listTools } = await import('../modules/chatbot/tools/registry.js');
    await import('../modules/chatbot/service.js');
    const analytics = listTools().filter((t) => t.name.startsWith('analytics.'));
    expect(analytics.map((t) => t.name)).toEqual(['analytics.my_stats']);
  });
});

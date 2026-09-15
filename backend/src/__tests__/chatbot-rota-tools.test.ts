import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * The rota tools of 2026-09-15: handing a shift to someone else, and applying
 * a dictated plan. What matters most is what each refuses, and in what ORDER
 * a plan is written -- a sick day must free its day before a shift is placed
 * on it.
 */

const mockList = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockReassign = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockPlace = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockAbsence = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveHotel = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveWorker = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const calls: string[] = [];

jest.mock('../modules/assignments/service.js', () => ({
  assignmentService: { list: mockList, reassign: mockReassign, placeOnCalendar: mockPlace },
}));
jest.mock('../modules/calendar/service.js', () => ({ calendarService: { markAbsenceForWorker: mockAbsence } }));
jest.mock('../modules/rooms/service.js', () => ({ roomService: {} }));
jest.mock('../modules/chatbot/tools/definitions/daily-operations.tools.js', () => ({ todayIso: () => '2026-09-15' }));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveHotelReference: mockResolveHotel,
  resolveWorkerReference: mockResolveWorker,
  describeUnresolved: (r: any) => `No worker matching "${r.query}" is on your team.`,
  refuseUnresolved: (r: any) => ({
    refused: { code: 'NOT_FOUND', message: `No worker matching "${r.query}" is on your team.`, nextAction: 'ask_user' },
  }),
  refuseUnresolvedHotel: () => ({ refused: { code: 'NOT_FOUND', message: 'no hotel', nextAction: 'ask_user' } }),
}));

import { swapWorker } from '../modules/chatbot/tools/definitions/shift-changes.tools.js';
import { applyPlan } from '../modules/chatbot/tools/definitions/plan.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const manager = (): ActorContext =>
  ({ userId: 'm1', role: 'manager', permissions: ROLE_PERMISSIONS.MANAGER ?? [], scope: { type: 'hotel', hotel_id: 'h1' } }) as unknown as ActorContext;
const regional = (): ActorContext =>
  ({ userId: 'r1', role: 'regional_manager', permissions: ROLE_PERMISSIONS.REGIONAL_MANAGER ?? [], scope: null }) as unknown as ActorContext;
const worker = (): ActorContext =>
  ({ userId: 'w9', role: 'worker', permissions: ROLE_PERMISSIONS.WORKER ?? [], scope: null }) as unknown as ActorContext;

const PEOPLE: Record<string, string> = { parveen: 'w1', anna: 'w2', tomasz: 'w3' };
const FULL: Record<string, string> = { w1: 'Parveen Kumar', w2: 'Anna Braun', w3: 'Tomasz Nowak' };

const summaryOf = (tool: { compress?: (raw: unknown) => { summary: string } }, raw: unknown) =>
  tool.compress?.(raw).summary ?? '';

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
  mockResolveHotel.mockResolvedValue({ status: 'RESOLVED', hotelId: 'h1', name: 'Hotel Adler' });
  mockResolveWorker.mockImplementation(async (q: string) => {
    const id = PEOPLE[q.toLowerCase().split(' ')[0]!];
    return id ? { status: 'RESOLVED', workerId: id, fullName: FULL[id], hotelId: 'h1' } : { status: 'NOT_FOUND', query: q };
  });
  mockList.mockResolvedValue({ data: [{ id: 'a1', status: 'CONFIRMED', worker_id: 'w1', day: '2026-09-17' }], total: 1 });
  mockReassign.mockResolvedValue({});
  mockPlace.mockImplementation(async () => {
    calls.push('place');
    return {};
  });
  mockAbsence.mockImplementation(async () => {
    calls.push('absence');
    return {};
  });
});

describe('assignments.swap_worker -- "Parveen can\'t come Thursday, give it to Anna"', () => {
  it('hands the live shift over in ONE atomic service call', async () => {
    const out = await swapWorker.invoke({ worker_name: 'parveen', new_worker_name: 'anna', day: '2026-09-17' }, manager());

    expect(mockReassign).toHaveBeenCalledTimes(1);
    expect(mockReassign.mock.calls[0]!.slice(0, 2)).toEqual(['a1', { worker_id: 'w2' }]);
    expect(summaryOf(swapWorker, out)).toBe('Anna Braun now has the shift at Hotel Adler on 2026-09-17, instead of Parveen Kumar.');
  });

  it('refuses before confirming when the new worker is unknown', async () => {
    const refusal = await swapWorker.precheck!({ worker_name: 'parveen', new_worker_name: 'Bogdan', day: '2026-09-17' }, manager());
    expect(refusal).toMatchObject({ refused: { message: expect.stringMatching(/Bogdan/) } });
    expect(mockReassign).not.toHaveBeenCalled();
  });

  it('refuses when there is no shift to hand over', async () => {
    mockList.mockResolvedValue({ data: [], total: 0 });
    const out = await swapWorker.invoke({ worker_name: 'parveen', new_worker_name: 'anna', day: '2026-09-17' }, manager());
    expect(mockReassign).not.toHaveBeenCalled();
    expect(summaryOf(swapWorker, out)).toMatch(/has no shift/);
  });

  it('refuses handing a shift to the person who already has it', async () => {
    const out = await swapWorker.invoke({ worker_name: 'parveen', new_worker_name: 'parveen kumar', day: '2026-09-17' }, manager());
    expect(mockReassign).not.toHaveBeenCalled();
    expect(summaryOf(swapWorker, out)).toMatch(/already Parveen Kumar's/);
  });

  it('refuses a finished shift', async () => {
    mockList.mockResolvedValue({ data: [{ id: 'a1', status: 'COMPLETED', worker_id: 'w1', day: '2026-09-17' }], total: 1 });
    const out = await swapWorker.invoke({ worker_name: 'parveen', new_worker_name: 'anna', day: '2026-09-17' }, manager());
    expect(mockReassign).not.toHaveBeenCalled();
    expect(summaryOf(swapWorker, out)).toMatch(/no longer live|already finished/);
  });

  it('takes names, never ids, and is confirmed and out of a worker\'s reach', () => {
    expect(swapWorker.args.safeParse({ worker_name: 'Anna', new_worker_name: 'Tom', day: '2026-09-17', worker_id: 'w1' }).success).toBe(false);
    expect({ tier: swapWorker.tier, confirm: swapWorker.confirm }).toEqual({ tier: 'HIGH_RISK_WRITE', confirm: true });
    expect(actorHasPermission(worker(), swapWorker.permission!)).toBe(false);
    expect(actorHasPermission(manager(), swapWorker.permission!)).toBe(true);
  });
});

describe('calendar.apply_plan -- "Anna is off sick Monday, put Tomasz on Monday and Tuesday"', () => {
  const PLAN = {
    absences: [{ worker_name: 'anna', day: '2026-09-21', kind: 'SICK' as const }],
    placements: [
      { worker_name: 'tomasz', day: '2026-09-21' },
      { worker_name: 'tomasz', day: '2026-09-22' },
    ],
  };

  it('records absences BEFORE placing shifts, so a sick day frees its day first', async () => {
    const out = await applyPlan.invoke(PLAN, manager());

    expect(calls).toEqual(['absence', 'place', 'place']);
    expect(mockAbsence.mock.calls[0]![0]).toEqual({ worker_id: 'w2', day: '2026-09-21', kind: 'SICK' });
    expect(mockPlace.mock.calls.map((c) => c[0])).toEqual([
      { worker_id: 'w3', hotel_id: 'h1', day: '2026-09-21' },
      { worker_id: 'w3', hotel_id: 'h1', day: '2026-09-22' },
    ]);
    expect(summaryOf(applyPlan, out)).toBe('At Hotel Adler: recorded 1 absence and scheduled 2 shifts.');
  });

  /** Applying the resolvable half would leave a plan the manager thinks is on the calendar. */
  it('writes NOTHING when any name in either list cannot be resolved', async () => {
    const out = await applyPlan.invoke(
      { ...PLAN, placements: [...PLAN.placements, { worker_name: 'Bogdan', day: '2026-09-23' }] },
      manager()
    );
    expect(calls).toEqual([]);
    expect(summaryOf(applyPlan, out)).toMatch(/^Nothing was changed\. No worker matching "Bogdan"/);
  });

  it('reports each entry that fails, with the service\'s own reason, and keeps the rest', async () => {
    mockPlace.mockImplementationOnce(async () => {
      throw new Error('Worker already has an assignment for this day');
    });
    const out = await applyPlan.invoke(PLAN, manager());

    expect(mockPlace).toHaveBeenCalledTimes(2);
    expect(summaryOf(applyPlan, out)).toBe(
      'At Hotel Adler: recorded 1 absence and scheduled 1 shift. Not done: Tomasz Nowak on 2026-09-21 -- Worker already has an assignment for this day.'
    );
  });

  it('refuses a holiday without a reason at proposal time, and an empty plan', () => {
    expect(applyPlan.args.safeParse({ absences: [{ worker_name: 'anna', day: '2026-09-21', kind: 'VACATION' }] }).success).toBe(false);
    expect(applyPlan.args.safeParse({ absences: [{ worker_name: 'anna', day: '2026-09-21', kind: 'VACATION', reason: 'wedding' }] }).success).toBe(true);
    expect(applyPlan.args.safeParse({}).success).toBe(false);
  });

  it('needs BOTH management tokens, which manager and regional manager hold and a worker does not', () => {
    expect(applyPlan.permission).toEqual(['staffing:write', 'calendar:absence:write-team']);
    expect(actorHasPermission(manager(), applyPlan.permission!)).toBe(true);
    expect(actorHasPermission(regional(), applyPlan.permission!)).toBe(true);
    expect(actorHasPermission(worker(), applyPlan.permission!)).toBe(false);
  });
});

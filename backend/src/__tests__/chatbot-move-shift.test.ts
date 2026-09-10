import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * `assignments.move_shift`.
 *
 * FOUND BY PROBING with a manager's own words, not by reading code: "move
 * anna to tomorrow" routed to `assignments.place_worker`, which ADDS a
 * placement. The manager would have been told the shift moved while the old
 * day still held one -- or watched it fail on the one-active-assignment-per-day
 * invariant, for a reason unrelated to what they asked.
 *
 * Most of what is asserted here is what it REFUSES to do. Moving the wrong
 * shift is silent: the rota still looks full, and nobody finds out until the
 * day nobody turns up.
 */

const mockListEntries = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockMoveEntry = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/assignments/service.js', () => ({
  assignmentService: { listCalendarEntries: mockListEntries, moveCalendarEntry: mockMoveEntry },
}));
jest.mock('../modules/attendance/service.js', () => ({ attendanceService: {} }));
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

import { moveShift } from '../modules/chatbot/tools/definitions/planning.tools.js';
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

const entry = (id: string, day: string, status = 'CONFIRMED') => ({
  id,
  day: `${day}T00:00:00.000Z`,
  assignment_status: status,
});

const summaryOf = (raw: unknown) => moveShift.compress?.(raw).summary ?? '';
const codeOf = (raw: unknown) =>
  (moveShift.compress?.(raw).data as { refusal_code?: string } | null)?.refusal_code;

beforeEach(() => {
  jest.clearAllMocks();
  mockListEntries.mockResolvedValue({ data: [entry('ce1', '2026-09-15')], total: 1 });
  mockMoveEntry.mockResolvedValue({ assignment: {}, calendar_entry: {} });
});

describe('it moves, rather than placing a second shift', () => {
  it('moves the one upcoming shift when no source day is given', async () => {
    await moveShift.invoke({ worker_name: 'Anna', to_day: '2026-09-16' } as never, manager());

    const [entryId, input] = mockMoveEntry.mock.calls[0] as [string, { day: string }];
    expect({ entryId, day: input.day }).toEqual({ entryId: 'ce1', day: '2026-09-16' });
  });

  it('says what it moved, and that the old day is now empty', async () => {
    const out = await moveShift.invoke(
      { worker_name: 'Anna', to_day: '2026-09-16' } as never,
      manager()
    );
    expect(summaryOf(out)).toMatch(/Moved Anna Braun's shift.*2026-09-15.*2026-09-16/);
    expect(summaryOf(out)).toMatch(/Nothing is left on 2026-09-15/);
  });

  it('takes no calendar-entry id from the caller', () => {
    for (const bad of [{ entry_id: 'ce1' }, { assignment_id: 'a1' }, { worker_id: 'w1' }]) {
      expect(
        moveShift.args.safeParse({ worker_name: 'Anna', to_day: '2026-09-16', ...bad }).success
      ).toBe(false);
    }
  });
});

describe('what it refuses', () => {
  /**
   * THE ONE THAT MATTERS. "Move Anna to Tuesday" when Anna works Monday and
   * Friday could mean either. Picking one moves a shift nobody asked about,
   * and the rota still looks correct afterwards.
   */
  it('refuses and lists the days when several shifts could be meant', async () => {
    mockListEntries.mockResolvedValue({
      data: [entry('ce1', '2026-09-15'), entry('ce2', '2026-09-18')],
      total: 2,
    });

    const out = await moveShift.invoke(
      { worker_name: 'Anna', to_day: '2026-09-16' } as never,
      manager()
    );

    expect(mockMoveEntry).not.toHaveBeenCalled();
    expect(codeOf(out)).toBe('AMBIGUOUS');
    expect(summaryOf(out)).toMatch(/2026-09-15, 2026-09-18/);
  });

  it('moves without asking once the source day is named', async () => {
    mockListEntries.mockResolvedValue({ data: [entry('ce2', '2026-09-18')], total: 1 });

    await moveShift.invoke(
      { worker_name: 'Anna', to_day: '2026-09-16', from_day: '2026-09-18' } as never,
      manager()
    );
    expect(mockMoveEntry).toHaveBeenCalledTimes(1);
  });

  it('refuses when there is nothing to move', async () => {
    mockListEntries.mockResolvedValue({ data: [], total: 0 });
    const out = await moveShift.invoke(
      { worker_name: 'Anna', to_day: '2026-09-16' } as never,
      manager()
    );

    expect(mockMoveEntry).not.toHaveBeenCalled();
    expect(codeOf(out)).toBe('NOT_FOUND');
  });

  /**
   * A cancelled placement is still a row. Moving one would resurrect a shift
   * nobody is coming to -- the "ghost shift" the calendar grid was already
   * bitten by once.
   */
  it('ignores cancelled and reassigned placements', async () => {
    mockListEntries.mockResolvedValue({
      data: [entry('ce1', '2026-09-15', 'CANCELLED'), entry('ce2', '2026-09-18', 'REASSIGNED')],
      total: 2,
    });

    const out = await moveShift.invoke(
      { worker_name: 'Anna', to_day: '2026-09-16' } as never,
      manager()
    );

    expect(mockMoveEntry).not.toHaveBeenCalled();
    expect(codeOf(out)).toBe('NOT_FOUND');
  });

  /** Moving a shift onto the day it is already on is a no-op dressed as work. */
  it('rejects moving a shift to the day it already sits on', () => {
    expect(
      moveShift.args.safeParse({
        worker_name: 'Anna',
        to_day: '2026-09-15',
        from_day: '2026-09-15',
      }).success
    ).toBe(false);
  });

  it('does not count a shift already on the target day as the one to move', async () => {
    mockListEntries.mockResolvedValue({
      data: [entry('ce1', '2026-09-16'), entry('ce2', '2026-09-18')],
      total: 2,
    });

    // Only ce2 is a candidate; ce1 is already where we are moving to.
    await moveShift.invoke({ worker_name: 'Anna', to_day: '2026-09-16' } as never, manager());
    const [entryId] = mockMoveEntry.mock.calls[0] as [string];
    expect(entryId).toBe('ce2');
  });
});

describe('who can use it', () => {
  it('is confirmed before it runs, and out of a worker\'s reach', () => {
    expect({ tier: moveShift.tier, confirm: moveShift.confirm }).toEqual({
      tier: 'HIGH_RISK_WRITE',
      confirm: true,
    });
    const worker = { role: 'worker', permissions: ROLE_PERMISSIONS.WORKER ?? [] } as never;
    expect(actorHasPermission(worker, moveShift.permission!)).toBe(false);
    expect(actorHasPermission(manager() as never, moveShift.permission!)).toBe(true);
  });

  it('searches only the resolved hotel and worker', async () => {
    await moveShift.invoke({ worker_name: 'Anna', to_day: '2026-09-16' } as never, manager());
    const [query] = mockListEntries.mock.calls[0] as [Record<string, unknown>];
    expect({ worker: query.worker_id, hotel: query.hotel_id }).toEqual({
      worker: 'w1',
      hotel: 'h1',
    });
  });
});

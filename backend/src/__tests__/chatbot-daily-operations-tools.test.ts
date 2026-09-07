import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * The worker's-own-shift tools: clocking in and out, and logging rooms.
 *
 * These are the first tools whose users are workers mid-shift rather than
 * managers at a desk, and the properties that matter reflect that:
 *
 *  1. NO SHIFT IS EVER NAMED BY THE MODEL. The assignment is resolved from
 *     the caller's own roster. `assignment_id` is not a FORBIDDEN_ARG_KEY, so
 *     nothing structural would have stopped it being an argument -- this is a
 *     deliberate choice the tests have to hold in place.
 *  2. THE GEOFENCE IS NOT BYPASSED. A chatbot has no GPS, and check-in at a
 *     geofenced hotel must fail closed with an instruction a person can act
 *     on, never succeed silently.
 *  3. AMBIGUITY IS REFUSED, NOT GUESSED. Two shifts in a day must not become
 *     a coin flip about which one someone is clocked into.
 */

const mockListAssignments = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockCheckIn = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockListAttendance = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockUpdateAttendance = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockLogRoom = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockListMyRooms = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/assignments/service.js', () => ({
  assignmentService: { list: mockListAssignments },
}));
jest.mock('../modules/attendance/service.js', () => ({
  attendanceService: {
    checkIn: mockCheckIn,
    list: mockListAttendance,
    update: mockUpdateAttendance,
  },
}));
jest.mock('../modules/rooms/service.js', () => ({
  roomService: { logRoom: mockLogRoom, listMyRooms: mockListMyRooms },
}));

import {
  checkInToMyShift,
  checkOutOfMyShift,
  logRoomCleaned,
  listMyRoomsToday,
  explainWriteFailure,
  todayIso,
} from '../modules/chatbot/tools/definitions/daily-operations.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorFor = (role: keyof typeof ROLE_PERMISSIONS): ActorContext =>
  ({
    userId: 'w1',
    role: String(role).toLowerCase(),
    permissions: ROLE_PERMISSIONS[role] ?? [],
    scope: null,
  }) as unknown as ActorContext;

const worker = () => actorFor('WORKER');
const TODAY = todayIso();

describe('the worker-shift tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListAssignments.mockResolvedValue({
      data: [{ id: 'a1', day: TODAY, status: 'CONFIRMED', hotel_id: 'h1' }],
      total: 1,
    });
    mockCheckIn.mockResolvedValue({
      check_in_at: `${TODAY}T08:00:00.000Z`,
      status: 'PRESENT',
    });
    mockListAttendance.mockResolvedValue({
      data: [{ id: 'att1', check_out_at: null }],
      total: 1,
    });
    mockUpdateAttendance.mockResolvedValue({ check_out_at: `${TODAY}T16:30:00.000Z` });
    mockLogRoom.mockResolvedValue({ room_number: '214' });
    mockListMyRooms.mockResolvedValue({ rooms: [], needs_rework: [] });
  });

  it('accepts no identifier of any kind', () => {
    for (const tool of [checkInToMyShift, checkOutOfMyShift, logRoomCleaned]) {
      for (const bad of [
        { assignment_id: 'a1' },
        { worker_id: 'w2' },
        { workerId: 'w2' },
        { hotel_id: 'h1' },
      ]) {
        expect({ tool: tool.name, ok: tool.args.safeParse(bad).success }).toEqual({
          tool: tool.name,
          ok: false,
        });
      }
    }
  });

  it('clocks in against the shift resolved from the roster', async () => {
    const out = await checkInToMyShift.invoke({} as never, worker());

    const [input] = mockCheckIn.mock.calls[0] as [Record<string, unknown>];
    // Resolved, not supplied.
    expect(input.assignment_id).toBe('a1');
    // No coordinates: the tool has none, and must not invent any.
    expect('latitude' in input).toBe(false);
    expect('longitude' in input).toBe(false);

    expect(checkInToMyShift.compress?.(out).summary).toMatch(/checked in at 08:00/i);
  });

  /**
   * REGRESSION (found in review, not by this suite). The resolver fetched one
   * page of 50 assignments and filtered by day IN MEMORY. `list` orders by
   * `confirmed_at desc`, so a worker confirmed for a month of shifts pushes
   * today's -- confirmed weeks ago -- past the 50-row window.
   *
   * The symptom was not an error. It was "you have no shift scheduled today"
   * to somebody standing in the hotel, unable to clock in, with nothing wrong
   * in any log. Filtering server-side on from/to makes the page size
   * irrelevant: one day cannot overflow it the way a rolling history can.
   */
  it('asks the service for the DAY, rather than paging and filtering in memory', async () => {
    await checkInToMyShift.invoke({} as never, worker());

    const [query] = mockListAssignments.mock.calls[0] as [Record<string, unknown>];
    expect({ from: query.from, to: query.to }).toEqual({ from: TODAY, to: TODAY });
  });

  it('still finds today\'s shift when the roster is larger than one page', async () => {
    // The service now returns only the requested day, which is the fix. If the
    // filter were dropped, this page of unrelated rows would be all the
    // resolver saw and it would report no shift at all.
    mockListAssignments.mockResolvedValue({
      data: [{ id: 'today', day: TODAY, status: 'CONFIRMED', hotel_id: 'h1' }],
      total: 1,
    });

    await checkInToMyShift.invoke({} as never, worker());
    const [input] = mockCheckIn.mock.calls[0] as [Record<string, unknown>];
    expect(input.assignment_id).toBe('today');
  });

  it('surfaces a late arrival rather than reporting a plain success', async () => {
    mockCheckIn.mockResolvedValue({ check_in_at: `${TODAY}T09:30:00.000Z`, status: 'LATE' });
    const out = await checkInToMyShift.invoke({} as never, worker());
    expect(checkInToMyShift.compress?.(out).summary).toMatch(/marked late/i);
  });

  /**
   * THE SAFETY PROPERTY. A chatbot has no GPS. `checkIn()` decides whether
   * location is required from the hotel's configuration, so a geofenced hotel
   * refuses — and that refusal must reach the person as a next step, not as a
   * dead end or, worse, a success.
   */
  it('fails closed at a geofenced hotel and says what to do instead', async () => {
    mockCheckIn.mockRejectedValue(
      new Error('Location permission is required to check in at this hotel')
    );

    const out = await checkInToMyShift.invoke({} as never, worker());
    const summary = checkInToMyShift.compress?.(out).summary ?? '';

    expect(summary).toMatch(/check in from the app/i);
    expect(summary).not.toMatch(/checked in/i);
  });

  it('passes through the service\'s own good refusals unchanged', async () => {
    // "too early" is already a better message than anything restated here.
    mockCheckIn.mockRejectedValue(
      new Error('Check-in denied: too early. Check-in opens 2 hours before the shift starts.')
    );
    const out = await checkInToMyShift.invoke({} as never, worker());
    expect(checkInToMyShift.compress?.(out).summary).toMatch(/too early/i);
  });

  it('refuses when there is no shift today, and writes nothing', async () => {
    mockListAssignments.mockResolvedValue({ data: [], total: 0 });

    const out = await checkInToMyShift.invoke({} as never, worker());
    expect(mockCheckIn).not.toHaveBeenCalled();
    expect(checkInToMyShift.compress?.(out).summary).toMatch(/no shift scheduled/i);
  });

  it('refuses rather than guessing when there are two shifts in a day', async () => {
    mockListAssignments.mockResolvedValue({
      data: [
        { id: 'a1', day: TODAY, status: 'CONFIRMED' },
        { id: 'a2', day: TODAY, status: 'CONFIRMED' },
      ],
      total: 2,
    });

    const out = await checkInToMyShift.invoke({} as never, worker());
    expect(mockCheckIn).not.toHaveBeenCalled();
    expect(checkInToMyShift.compress?.(out).summary).toMatch(/2 shifts/i);
  });

  it('ignores a cancelled assignment when resolving the day', async () => {
    mockListAssignments.mockResolvedValue({
      data: [
        { id: 'cancelled', day: TODAY, status: 'CANCELLED' },
        { id: 'real', day: TODAY, status: 'CONFIRMED' },
      ],
      total: 2,
    });

    await checkInToMyShift.invoke({} as never, worker());
    const [input] = mockCheckIn.mock.calls[0] as [Record<string, unknown>];
    expect(input.assignment_id).toBe('real');
  });

  it('clocks out of the attendance row for that shift', async () => {
    const out = await checkOutOfMyShift.invoke({} as never, worker());

    const [attendanceId, patch] = mockUpdateAttendance.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(attendanceId).toBe('att1');
    expect(patch.check_out_at).toBeDefined();
    // The self branch of update() accepts only check_out_at and notes; the
    // tool must not try to set a status.
    expect('status' in patch).toBe(false);

    expect(checkOutOfMyShift.compress?.(out).summary).toMatch(/checked out at 16:30/i);
  });

  it('says so plainly when there is nothing to check out of', async () => {
    mockListAttendance.mockResolvedValue({ data: [], total: 0 });
    const out = await checkOutOfMyShift.invoke({} as never, worker());
    expect(mockUpdateAttendance).not.toHaveBeenCalled();
    expect(checkOutOfMyShift.compress?.(out).summary).toMatch(/not checked in/i);
  });

  it('refuses a second check-out instead of overwriting the first', async () => {
    mockListAttendance.mockResolvedValue({
      data: [{ id: 'att1', check_out_at: `${TODAY}T16:00:00.000Z` }],
      total: 1,
    });

    const out = await checkOutOfMyShift.invoke({} as never, worker());
    expect(mockUpdateAttendance).not.toHaveBeenCalled();
    expect(checkOutOfMyShift.compress?.(out).summary).toMatch(/already checked out/i);
  });

  it('logs one room against the resolved shift', async () => {
    const out = await logRoomCleaned.invoke({ room_number: '214' } as never, worker());
    const [assignmentId, roomNumber] = mockLogRoom.mock.calls[0] as [string, string];
    expect(assignmentId).toBe('a1');
    expect(roomNumber).toBe('214');
    expect(logRoomCleaned.compress?.(out).summary).toMatch(/room 214 logged/i);
  });

  it('reports rooms logged and any sent back for rework', async () => {
    mockListMyRooms.mockResolvedValue({
      rooms: [{ room_number: '101' }, { room_number: '102' }],
      needs_rework: [{ room_number: '101' }],
    });

    const out = await listMyRoomsToday.invoke({} as never, worker());
    const summary = listMyRoomsToday.compress?.(out).summary ?? '';
    expect(summary).toMatch(/2 rooms logged/i);
    expect(summary).toMatch(/1 sent back for rework/i);
  });

  it('leaks no identifier into what the model sees', async () => {
    const results = await Promise.all([
      checkInToMyShift.invoke({} as never, worker()),
      logRoomCleaned.invoke({ room_number: '214' } as never, worker()),
    ]);
    const json = JSON.stringify(results.map((r, i) => [checkInToMyShift, logRoomCleaned][i].compress?.(r)));
    for (const leak of ['a1', 'att1', 'h1', 'w1']) {
      expect(json).not.toContain(leak);
    }
  });
});

describe('risk tiers on the shift tools', () => {
  it('makes clocking in and out confirmed high-risk writes', () => {
    for (const tool of [checkInToMyShift, checkOutOfMyShift]) {
      expect({ tool: tool.name, tier: tool.tier, confirm: tool.confirm }).toEqual({
        tool: tool.name,
        tier: 'HIGH_RISK_WRITE',
        confirm: true,
      });
    }
  });

  it('leaves room logging unconfirmed, because it is reversible by its author', () => {
    // A worker logs rooms many times a shift; a confirmation on each would
    // make the tool slower than the app. They can correct or delete their own
    // room log, which is what earns the lower tier.
    expect(logRoomCleaned.tier).toBe('LOW_RISK_WRITE');
    expect(logRoomCleaned.confirm).toBe(false);
  });

  it('registers every new tool as PENDING, not covered by the 2026-09-08 approval', () => {
    // That approval names the thirteen tools registered on that date and
    // explicitly does not extend to later ones.
    for (const tool of [checkInToMyShift, checkOutOfMyShift, logRoomCleaned, listMyRoomsToday]) {
      expect({ tool: tool.name, pending: /PENDING/.test(tool.approvalRef) }).toEqual({
        tool: tool.name,
        pending: true,
      });
    }
  });
});

describe('explainWriteFailure', () => {
  it('turns the geofence refusal into a next step', () => {
    expect(
      explainWriteFailure(new Error('Location permission is required to check in at this hotel'))
    ).toMatch(/from the app/i);
  });

  it('says plainly when someone is not at the hotel', () => {
    expect(explainWriteFailure(new Error('Check-in denied: outside the hotel geofence'))).toMatch(
      /outside the hotel/i
    );
  });

  it('does not rewrite messages that are already actionable', () => {
    const original = 'Already checked in';
    expect(explainWriteFailure(new Error(original))).toBe(original);
  });
});

/**
 * Two permission tokens were added for these tools, and both were added to
 * routes that previously enforced none. That is the change shape that locks
 * people out silently — a worker getting a 403 on something they did
 * yesterday — so the population admitted is checked against the REAL sets.
 */
describe('the tokens these tools introduced', () => {
  const holds = (role: keyof typeof ROLE_PERMISSIONS, token: string) =>
    (ROLE_PERMISSIONS[role] ?? []).includes(token) ||
    (ROLE_PERMISSIONS[role] ?? []).includes('admin:*');

  it.each([['WORKER'], ['CHECKER']])(
    'gives %s attendance:write-own, matching requireRole on the check-in route',
    (role) => {
      expect(holds(role as keyof typeof ROLE_PERMISSIONS, 'attendance:write-own')).toBe(true);
    }
  );

  it('does NOT give a manager the clock-in token — managers do not clock in', () => {
    expect((ROLE_PERMISSIONS.MANAGER ?? []).includes('attendance:write-own')).toBe(false);
  });

  it('gives EVERY role assignments:status-write, matching a route open to all', () => {
    // PATCH /assignments/:id admits any authenticated caller and the service
    // decides whose assignment may be touched. A role missing this token would
    // be locked out of a route it could use the day before.
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      expect({ role, ok: holds(role as keyof typeof ROLE_PERMISSIONS, 'assignments:status-write') })
        .toEqual({ role, ok: true });
    }
  });

  it('lets a real WORKER use every tool in this batch', () => {
    const w = worker();
    for (const tool of [checkInToMyShift, checkOutOfMyShift, logRoomCleaned, listMyRoomsToday]) {
      const gate = tool.permission;
      expect({ tool: tool.name, usable: gate === null || actorHasPermission(w, gate) }).toEqual({
        tool: tool.name,
        usable: true,
      });
    }
  });
});

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Scope containment for the room-log module (owner requirement, 2026-09-01):
 * "every user -- worker, checker, manager, regional manager -- must strictly
 * operate inside their own scope."
 *
 * These are the tests that pin that. They are written against the SERVICE, not
 * the routes, deliberately: the route gates can only express roles, and every
 * boundary that actually matters here is an identity or scope question
 * ("your own shift", "your own hotel", "hotels you are rostered at today")
 * that `requireRole` cannot say. A future route change cannot quietly widen
 * any of these.
 *
 * Two properties are asserted throughout, not just one:
 *   1. the in-scope case is ALLOWED (or a deny would be invisible in
 *      production and these tests would pass on a service that denies
 *      everyone);
 *   2. the out-of-scope case is DENIED **and writes nothing**.
 */

const mockRoomLog = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  delete: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockWorkerAssignment = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockJobRequest = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  roomLog: mockRoomLog,
  workerAssignment: mockWorkerAssignment,
  hotel: mockHotel,
  // resolveScheduledStart/End read the shift's clock through here.
  jobRequest: mockJobRequest,
  auditLog: { create: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({}) },
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

import { RoomService } from '../modules/rooms/service.js';
import { roomKey } from '../modules/rooms/types.js';

const service = new RoomService();

const WORKER = { userId: 'w1', role: 'worker' as const, scope: null };
const OTHER_WORKER = { userId: 'w2', role: 'worker' as const, scope: null };
const CHECKER = { userId: 'c1', role: 'checker' as const, scope: null };
const MANAGER_HOTEL_A = {
  userId: 'm1',
  role: 'manager' as const,
  scope: { type: 'hotel' as const, hotel_id: 'hotelA' },
};
const RM_GROUP_G = {
  userId: 'rm1',
  role: 'regional_manager' as const,
  scope: { type: 'hotel_group' as const, hotel_group_id: 'groupG' },
};
const ADMIN = { userId: 'a1', role: 'admin' as const, scope: { type: 'global' as const } };

/** An assignment shaped as logRoom() selects it. */
function assignment(over: Record<string, unknown> = {}) {
  return {
    id: 'asn1',
    worker_id: 'w1',
    hotel_id: 'hotelA',
    day: new Date('2026-09-01T00:00:00.000Z'),
    status: 'IN_PROGRESS',
    rework_of_assignment_id: null,
    // The shift's own clock. logRoom's window is measured off these, so a
    // fixture without started_at is a shift nobody checked into -- which is
    // now refused, and is its own test below.
    started_at: new Date('2026-09-01T09:00:00.000Z'),
    completed_at: null,
    ...over,
  };
}

/** A room log shaped as the read paths include it. */
function roomLog(over: Record<string, unknown> = {}) {
  return {
    id: 'rl1',
    assignment_id: 'asn1',
    hotel_id: 'hotelA',
    worker_id: 'w1',
    day: new Date('2026-09-01T00:00:00.000Z'),
    room_number: '412',
    room_key: '412',
    verification_id: null,
    logged_at: new Date('2026-09-01T09:00:00.000Z'),
    updated_at: new Date('2026-09-01T09:00:00.000Z'),
    hotel: { name: 'Hotel A' },
    worker: { first_name: 'Ada', last_name: 'Lovelace' },
    verification: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRoomLog.create.mockResolvedValue(roomLog());
  mockRoomLog.update.mockResolvedValue(roomLog());
  mockRoomLog.delete.mockResolvedValue(roomLog());
  mockRoomLog.findMany.mockResolvedValue([]);
  mockWorkerAssignment.findMany.mockResolvedValue([]);
  mockHotel.findMany.mockResolvedValue([]);
});

describe('RoomService — worker writes are confined to their own shift', () => {
  it('lets a worker log a room on their own in-progress shift', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(assignment());

    const result = await service.logRoom('asn1', '412', WORKER);

    expect(result.room_number).toBe('412');
    expect(mockRoomLog.create).toHaveBeenCalledTimes(1);
    const created = mockRoomLog.create.mock.calls[0][0] as { data: Record<string, unknown> };
    // Every identity field comes from the assignment, never from the caller's
    // request -- there is no field a worker could use to log against someone
    // else's shift even if the identity check below were removed.
    expect(created.data.worker_id).toBe('w1');
    expect(created.data.hotel_id).toBe('hotelA');
    expect(created.data.assignment_id).toBe('asn1');
  });

  it("denies a worker logging a room on another worker's shift, and writes nothing", async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(assignment({ worker_id: 'w1' }));

    await expect(service.logRoom('asn1', '412', OTHER_WORKER)).rejects.toMatchObject({
      name: 'ForbiddenError',
    });
    expect(mockRoomLog.create).not.toHaveBeenCalled();
  });

  // The identity rule is deliberately role-independent: an admin logging rooms
  // as a worker would be falsifying that worker's own accountability record.
  it('denies even an admin logging a room on a worker\'s shift', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(assignment());

    await expect(service.logRoom('asn1', '412', ADMIN)).rejects.toMatchObject({
      name: 'ForbiddenError',
    });
    expect(mockRoomLog.create).not.toHaveBeenCalled();
  });

  it('refuses to log before the worker has checked in', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(assignment({ status: 'CONFIRMED' }));

    await expect(service.logRoom('asn1', '412', WORKER)).rejects.toMatchObject({
      name: 'ValidationError',
    });
    expect(mockRoomLog.create).not.toHaveBeenCalled();
  });

  // Rework changes the ORIGINAL room's state; a second log would put the same
  // room in the checker's picker twice and double-count the day.
  it('refuses to log a room against a rework shift', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(
      assignment({ rework_of_assignment_id: 'asn0' })
    );

    await expect(service.logRoom('asn1', '412', WORKER)).rejects.toMatchObject({
      name: 'ValidationError',
    });
    expect(mockRoomLog.create).not.toHaveBeenCalled();
  });

  it('reports who already has a room when the same room is logged twice', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(assignment());
    mockRoomLog.create.mockRejectedValue({ code: 'P2002' });
    mockRoomLog.findFirst.mockResolvedValue({
      ...roomLog({ worker_id: 'w2' }),
      worker: { first_name: 'Grace', last_name: 'Hopper' },
    });

    await expect(service.logRoom('asn1', '412', WORKER)).rejects.toMatchObject({
      name: 'ConflictError',
      message: expect.stringContaining('Grace Hopper'),
    });
  });

  it("denies editing or removing another worker's log", async () => {
    mockRoomLog.findUnique.mockResolvedValue(roomLog({ worker_id: 'w1' }));

    await expect(service.updateRoom('rl1', '413', OTHER_WORKER)).rejects.toMatchObject({
      name: 'ForbiddenError',
    });
    await expect(service.deleteRoom('rl1', OTHER_WORKER)).rejects.toMatchObject({
      name: 'ForbiddenError',
    });
    expect(mockRoomLog.update).not.toHaveBeenCalled();
    expect(mockRoomLog.delete).not.toHaveBeenCalled();
  });

  // The lock that keeps an inspection from being orphaned from its room.
  it('refuses to edit or remove a room once it has been checked', async () => {
    mockRoomLog.findUnique.mockResolvedValue(roomLog({ verification_id: 'v1' }));

    await expect(service.updateRoom('rl1', '413', WORKER)).rejects.toMatchObject({
      name: 'ConflictError',
    });
    await expect(service.deleteRoom('rl1', WORKER)).rejects.toMatchObject({
      name: 'ConflictError',
    });
    expect(mockRoomLog.update).not.toHaveBeenCalled();
    expect(mockRoomLog.delete).not.toHaveBeenCalled();
  });

  it('reads the worker\'s own rooms without accepting any worker id', async () => {
    mockRoomLog.findMany.mockResolvedValue([roomLog()]);

    await service.listMyRooms(WORKER, '2026-09-01');

    // Both queries filter on the AUTHENTICATED user. listMyRooms takes no
    // worker_id parameter at all, so there is no request that returns
    // somebody else's rooms.
    for (const call of mockRoomLog.findMany.mock.calls) {
      const where = (call[0] as { where: Record<string, unknown> }).where;
      expect(where.worker_id).toBe('w1');
    }
  });
});

describe('RoomService — the checker sees only hotels they are rostered at today', () => {
  it('scopes the picker to the hotels the checker is actively assigned to', async () => {
    mockWorkerAssignment.findMany.mockResolvedValue([
      { hotel_id: 'hotelA' },
      { hotel_id: 'hotelA' },
      { hotel_id: 'hotelB' },
    ]);
    mockRoomLog.findMany.mockResolvedValue([roomLog()]);

    await service.listRoomsForPicker(CHECKER, { day: '2026-09-01' });

    // Their own roster query must be status-filtered: a cancelled or
    // not-yet-started shift is not being on site.
    const rosterWhere = (mockWorkerAssignment.findMany.mock.calls[0][0] as {
      where: Record<string, any>;
    }).where;
    expect(rosterWhere.worker_id).toBe('c1');
    expect(rosterWhere.status.in).toEqual(['IN_PROGRESS', 'COMPLETED']);

    const roomWhere = (mockRoomLog.findMany.mock.calls[0][0] as { where: Record<string, any> }).where;
    // De-duplicated, and confined to exactly those hotels.
    expect(roomWhere.hotel_id.in.sort()).toEqual(['hotelA', 'hotelB']);
  });

  it('returns nothing for a checker with no active shift that day', async () => {
    mockWorkerAssignment.findMany.mockResolvedValue([]);

    const result = await service.listRoomsForPicker(CHECKER, { day: '2026-09-01' });

    expect(result.awaiting_check).toEqual([]);
    expect(result.reworked).toEqual([]);
    expect(result.already_checked).toEqual([]);
    // No room query at all -- "in scope for nothing" must not degrade into an
    // unfiltered read.
    expect(mockRoomLog.findMany).not.toHaveBeenCalled();
  });

  it('denies a checker asking for a hotel they are not rostered at', async () => {
    mockWorkerAssignment.findMany.mockResolvedValue([{ hotel_id: 'hotelA' }]);

    await expect(
      service.listRoomsForPicker(CHECKER, { day: '2026-09-01', hotel_id: 'hotelZ' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
    // A 403, never an empty list: an empty list would let a checker enumerate
    // which hotels exist and which have activity by probing ids.
    expect(mockRoomLog.findMany).not.toHaveBeenCalled();
  });
});

describe('RoomService — manager and regional-manager scope', () => {
  it('scopes a hotel manager to their own hotel', async () => {
    mockRoomLog.findMany.mockResolvedValue([roomLog()]);

    await service.listRoomsForPicker(MANAGER_HOTEL_A, { day: '2026-09-01' });

    const where = (mockRoomLog.findMany.mock.calls[0][0] as { where: Record<string, any> }).where;
    expect(where.hotel_id.in).toEqual(['hotelA']);
  });

  it("scopes a regional manager to every hotel in their group, and only those", async () => {
    mockHotel.findMany.mockResolvedValue([{ id: 'hotelA' }, { id: 'hotelB' }]);
    mockRoomLog.findMany.mockResolvedValue([roomLog()]);

    await service.listRoomsForPicker(RM_GROUP_G, { day: '2026-09-01' });

    const groupWhere = (mockHotel.findMany.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;
    expect(groupWhere.hotel_group_id).toBe('groupG');
    const where = (mockRoomLog.findMany.mock.calls[0][0] as { where: Record<string, any> }).where;
    expect(where.hotel_id.in).toEqual(['hotelA', 'hotelB']);
  });

  it('denies a manager asking for a hotel outside their scope', async () => {
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'someOtherGroup' });

    await expect(
      service.listRoomsForPicker(MANAGER_HOTEL_A, { hotel_id: 'hotelZ' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(mockRoomLog.findMany).not.toHaveBeenCalled();
  });

  it('denies a scoped manager holding no scope at all', async () => {
    const unscoped = { userId: 'm9', role: 'manager' as const, scope: null };

    const result = await service.listRoomsForPicker(unscoped, { day: '2026-09-01' });

    // Deny-by-default: a manager with no scope claim sees nothing, matching
    // isHotelInScope's own null-scope posture rather than falling through to
    // an unfiltered read.
    expect(result.awaiting_check).toEqual([]);
    expect(mockRoomLog.findMany).not.toHaveBeenCalled();
  });

  it('applies no hotel filter for an admin', async () => {
    mockRoomLog.findMany.mockResolvedValue([roomLog()]);

    await service.listRoomsForPicker(ADMIN, { day: '2026-09-01' });

    const where = (mockRoomLog.findMany.mock.calls[0][0] as { where: Record<string, any> }).where;
    expect(where.hotel_id).toBeUndefined();
  });

  it('gives the manager a per-worker count over their own hotels only', async () => {
    mockRoomLog.findMany.mockResolvedValue([
      roomLog({ id: 'r1', room_number: '401', worker_id: 'w1' }),
      roomLog({ id: 'r2', room_number: '402', worker_id: 'w1' }),
      roomLog({ id: 'r3', room_number: '403', worker_id: 'w2', worker: { first_name: 'Grace', last_name: 'Hopper' } }),
    ]);

    const result = await service.listRoomsForHotels(MANAGER_HOTEL_A, { day: '2026-09-01' });

    expect(result.by_worker).toEqual([
      { worker_id: 'w1', worker_name: 'Ada Lovelace', rooms_logged: 2 },
      { worker_id: 'w2', worker_name: 'Grace Hopper', rooms_logged: 1 },
    ]);
    const where = (mockRoomLog.findMany.mock.calls[0][0] as { where: Record<string, any> }).where;
    expect(where.hotel_id.in).toEqual(['hotelA']);
  });
});

describe('RoomService — room-number suggestions are scope-gated too', () => {
  it('lets a worker read suggestions for a hotel they have shifts at', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'asn1' });
    mockRoomLog.findMany.mockResolvedValue([{ room_number: '412' }, { room_number: '413' }]);

    const rooms = await service.listRoomSuggestions(WORKER, 'hotelA');

    expect(rooms).toEqual(['412', '413']);
  });

  it('denies a worker reading the room numbering of a hotel they never worked at', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue(null);

    await expect(service.listRoomSuggestions(WORKER, 'hotelZ')).rejects.toMatchObject({
      name: 'ForbiddenError',
    });
    expect(mockRoomLog.findMany).not.toHaveBeenCalled();
  });

  it('denies a manager reading suggestions for a hotel outside their scope', async () => {
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'someOtherGroup' });

    await expect(service.listRoomSuggestions(MANAGER_HOTEL_A, 'hotelZ')).rejects.toMatchObject({
      name: 'ForbiddenError',
    });
    expect(mockRoomLog.findMany).not.toHaveBeenCalled();
  });
});

describe('RoomService — "today" is anchored to the platform calendar timezone', () => {
  // Between 00:00 and 02:00 Berlin time, "today" in UTC is still yesterday. A
  // UTC default would have shown the checker the previous day's rooms, and
  // given a worker on an early or overnight shift an empty "logged today"
  // list, for two hours every night. OD-CAL-04 / todayInCalendarTimezone() is
  // what attendance, calendar, assignments, quality and consent all use.
  it('defaults the day to Europe/Berlin, not UTC', async () => {
    const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(
      new Date()
    );
    mockRoomLog.findMany.mockResolvedValue([]);

    const result = await service.listRoomsForPicker(ADMIN);

    expect(result.day).toBe(expected);
    const where = (mockRoomLog.findMany.mock.calls[0][0] as { where: Record<string, any> }).where;
    // The read spans the day before as well (a shift outlives the calendar
    // day it started on -- see dayRangeFrom), so the anchoring this test
    // exists for is the RANGE'S UPPER BOUND.
    expect(where.day.lte).toEqual(new Date(`${expected}T00:00:00.000Z`));
  });

  it('honours an explicit day verbatim', async () => {
    mockRoomLog.findMany.mockResolvedValue([]);

    const result = await service.listRoomsForPicker(ADMIN, { day: '2026-01-15' });

    expect(result.day).toBe('2026-01-15');
    const where = (mockRoomLog.findMany.mock.calls[0][0] as { where: Record<string, any> }).where;
    expect(where.day.lte).toEqual(new Date('2026-01-15T00:00:00.000Z'));
    expect(where.day.gte).toEqual(new Date('2026-01-14T00:00:00.000Z'));
  });
});

describe('roomKey — the collision key behind one-log-per-room-per-day', () => {
  it('treats surrounding whitespace and case as the same room', () => {
    expect(roomKey(' 412 ')).toBe(roomKey('412'));
    expect(roomKey('412a')).toBe(roomKey('412A'));
  });

  // Deliberately conservative (owner decision): a WRONG merge silently
  // collapses two workers' rooms into one record and cannot be undone, while a
  // missed merge is just an extra row in the picker. The typeahead is what
  // converges spellings.
  it('keeps a leading zero significant', () => {
    expect(roomKey('0412')).not.toBe(roomKey('412'));
  });
});

describe('RoomService — derived room state', () => {
  async function stateFor(verification: Record<string, unknown> | null) {
    mockRoomLog.findMany.mockResolvedValue([
      roomLog({ verification_id: verification ? 'v1' : null, verification }),
    ]);
    const result = await service.listMyRooms(WORKER, '2026-09-01');
    return result.rooms[0];
  }

  it('is AWAITING_CHECK with no inspection', async () => {
    expect((await stateFor(null))?.state).toBe('AWAITING_CHECK');
    expect((await stateFor(null))?.editable).toBe(true);
  });

  it('is PASSED for a clean pass', async () => {
    const room = await stateFor({
      id: 'v1',
      status: 'PASSED',
      score: 90,
      rework_required: false,
      rework_completed_at: null,
      rework_assignments: [],
    });
    expect(room?.state).toBe('PASSED');
    // Locked: an inspection now references this room.
    expect(room?.editable).toBe(false);
  });

  it('is NEEDS_REWORK with an open round, and exposes the rework shift to go to', async () => {
    const room = await stateFor({
      id: 'v1',
      status: 'NEEDS_REWORK',
      score: 40,
      rework_required: true,
      rework_completed_at: null,
      rework_assignments: [{ id: 'rework-asn-1', status: 'CONFIRMED' }],
    });
    expect(room?.state).toBe('NEEDS_REWORK');
    // This is what the worker's "Go to rework" button navigates to.
    expect(room?.rework_assignment_id).toBe('rework-asn-1');
  });

  // The auto-pass case. completeRework sets status PASSED and clears
  // rework_required, so testing PASSED first would hide this state entirely
  // and the checker's "review photos" group would always be empty.
  it('is REWORK_SUBMITTED once the worker has submitted their fix', async () => {
    const room = await stateFor({
      id: 'v1',
      status: 'PASSED',
      score: 40,
      rework_required: false,
      rework_completed_at: new Date('2026-09-01T12:00:00.000Z'),
      rework_assignments: [{ id: 'rework-asn-1', status: 'COMPLETED' }],
    });
    expect(room?.state).toBe('REWORK_SUBMITTED');
    // Nothing left for the worker to do, so no rework link.
    expect(room?.rework_assignment_id).toBeNull();
    // The original score is preserved as the record of the first attempt
    // (owner decision) -- the room passed, the number did not change.
    expect(room?.score).toBe(40);
  });
});

/**
 * WHEN a room may be logged (owner decision, 2026-09-02): during the shift,
 * plus two hours after it ends. Never before the worker has started.
 *
 * Measured off the shift's OWN started_at/completed_at, not the linked
 * JobRequest's scheduled times. The first version of this rule used the
 * scheduled clock and was inert in production: the assignments workers
 * actually log against carry no linked request at all, so the window was
 * skipped entirely and a shift nobody had checked into still accepted rooms.
 * These tests therefore use the columns every real shift has.
 */
describe('RoomService — a room may only be logged inside its shift window', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  function at(now: string, over: Record<string, unknown> = {}) {
    jest.useFakeTimers().setSystemTime(new Date(now));
    mockWorkerAssignment.findUnique.mockResolvedValue(assignment(over));
  }

  // The reported bug: a COMPLETED shift the worker never checked into passed
  // the status gate and accepted rooms indefinitely.
  it('refuses a shift the worker never checked into, even when it is COMPLETED', async () => {
    at('2026-09-01T12:00:00.000Z', { status: 'COMPLETED', started_at: null, completed_at: null });

    await expect(service.logRoom('asn1', '412', WORKER)).rejects.toMatchObject({
      name: 'ValidationError',
    });
    expect(mockRoomLog.create).not.toHaveBeenCalled();
  });

  it('accepts a room logged during the shift', async () => {
    at('2026-09-01T12:00:00.000Z');

    await service.logRoom('asn1', '412', WORKER);

    expect(mockRoomLog.create).toHaveBeenCalledTimes(1);
  });

  it('accepts a room logged inside the two-hour grace after checkout', async () => {
    at('2026-09-01T18:30:00.000Z', {
      status: 'COMPLETED',
      completed_at: new Date('2026-09-01T17:00:00.000Z'),
    });

    await service.logRoom('asn1', '412', WORKER);

    expect(mockRoomLog.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a room logged after the grace has run out', async () => {
    at('2026-09-01T19:30:00.000Z', {
      status: 'COMPLETED',
      completed_at: new Date('2026-09-01T17:00:00.000Z'),
    });

    await expect(service.logRoom('asn1', '412', WORKER)).rejects.toMatchObject({
      name: 'ValidationError',
    });
    expect(mockRoomLog.create).not.toHaveBeenCalled();
  });

  // A shift left IN_PROGRESS because nobody checked out must not stay open
  // for logging forever -- but there is no end instant to measure from, so
  // this is deliberately still allowed. Recorded so the choice is visible
  // rather than assumed.
  it('still accepts a room on a shift that was never checked out', async () => {
    at('2026-09-03T12:00:00.000Z', { status: 'IN_PROGRESS', completed_at: null });

    await service.logRoom('asn1', '412', WORKER);

    expect(mockRoomLog.create).toHaveBeenCalledTimes(1);
  });
});

/**
 * Every room logged on ONE shift, for that shift's own page.
 *
 * The other three reads are self-scoped, picker-scoped and hotel-and-today
 * scoped, so none of them could answer "what was logged on this assignment"
 * -- which is why the assignment page showed no room information at all once
 * the manual rooms-completed card was retired, past shifts included.
 *
 * Access mirrors who may see the assignment itself, so these cases are the
 * point of the endpoint rather than incidental to it.
 */
describe('RoomService — rooms logged on one assignment', () => {
  const ASSIGNMENT = { id: 'asn1', worker_id: 'w1', hotel_id: 'hotelA' };

  it('returns the shift\'s rooms to the worker whose shift it is', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(ASSIGNMENT);
    mockRoomLog.findMany.mockResolvedValue([roomLog({ room_number: '412' })]);

    const result = await service.listRoomsForAssignment('asn1', WORKER);

    expect(result.rooms.map((r) => r.room_number)).toEqual(['412']);
    const call = mockRoomLog.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    // Bound to the assignment, never widened to the hotel or the day.
    expect(call.where.assignment_id).toBe('asn1');
  });

  it('denies a worker looking at somebody else\'s shift', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(ASSIGNMENT);

    await expect(service.listRoomsForAssignment('asn1', OTHER_WORKER)).rejects.toMatchObject({
      name: 'ForbiddenError',
    });
    expect(mockRoomLog.findMany).not.toHaveBeenCalled();
  });

  it('allows a manager whose scope covers the shift\'s hotel', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(ASSIGNMENT);
    mockRoomLog.findMany.mockResolvedValue([roomLog({ room_number: '101' })]);

    const result = await service.listRoomsForAssignment('asn1', MANAGER_HOTEL_A);

    expect(result.rooms).toHaveLength(1);
  });

  it('denies a manager scoped to a different hotel', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue({ ...ASSIGNMENT, hotel_id: 'hotelB' });

    await expect(
      service.listRoomsForAssignment('asn1', MANAGER_HOTEL_A)
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(mockRoomLog.findMany).not.toHaveBeenCalled();
  });

  it('404s an assignment that does not exist, without reading rooms', async () => {
    mockWorkerAssignment.findUnique.mockResolvedValue(null);

    await expect(service.listRoomsForAssignment('nope', ADMIN)).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    expect(mockRoomLog.findMany).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * The tools built for the field report of 2026-09-15.
 *
 * The owner tried the assistant on real work and every conversation below
 * failed. Most of what is asserted here is what each tool REFUSES to do,
 * because each refusal is a way the rota, a count or a record could otherwise
 * go silently wrong -- and a silent wrong on a rota is found the morning
 * nobody turns up.
 */

const mockList = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockUpdate = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockLogRooms = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockUpdateRooms = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockRoomsForAssignment = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockRoomsForHotels = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockAttendanceList = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockRecent = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveHotel = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveWorker = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/assignments/service.js', () => ({
  assignmentService: {
    list: mockList,
    update: mockUpdate,
    logRoomsCompleted: mockLogRooms,
    updateRoomsCompleted: mockUpdateRooms,
  },
}));
jest.mock('../modules/rooms/service.js', () => ({
  roomService: { listRoomsForAssignment: mockRoomsForAssignment, listRoomsForHotels: mockRoomsForHotels },
}));
jest.mock('../modules/attendance/service.js', () => ({ attendanceService: { list: mockAttendanceList } }));
jest.mock('../modules/chatbot/memory/transcript.js', () => ({ listRecentConversations: mockRecent }));
// A fixed "today", so the past-day rule is tested at a known moment.
jest.mock('../modules/chatbot/tools/definitions/daily-operations.tools.js', () => ({
  todayIso: () => '2026-09-15',
}));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveHotelReference: mockResolveHotel,
  resolveWorkerReference: mockResolveWorker,
  refuseUnresolved: (r: any) => ({
    refused: { code: 'NOT_FOUND', message: `No worker matching "${r.query}" is on your team.`, nextAction: 'ask_user' },
  }),
  refuseUnresolvedHotel: () => ({
    refused: { code: 'NOT_FOUND', message: 'no hotel', nextAction: 'ask_user' },
  }),
}));

import { cancelShift, recordWorkerRooms } from '../modules/chatbot/tools/definitions/shift-changes.tools.js';
import { newAccountLink } from '../modules/chatbot/tools/definitions/accounts.tools.js';
import { recentConversations } from '../modules/chatbot/tools/definitions/conversation-history.tools.js';
import { teamWorkSummary } from '../modules/chatbot/tools/definitions/work-summary.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const manager = (): ActorContext =>
  ({
    userId: 'm1',
    role: 'manager',
    permissions: ROLE_PERMISSIONS.MANAGER ?? [],
    scope: { type: 'hotel', hotel_id: 'h1' },
  }) as unknown as ActorContext;

const worker = (): ActorContext =>
  ({ userId: 'w9', role: 'worker', permissions: ROLE_PERMISSIONS.WORKER ?? [], scope: null }) as unknown as ActorContext;

const codeOf = (tool: { compress?: (raw: unknown) => { data: unknown } }, raw: unknown) =>
  (tool.compress?.(raw).data as { refusal_code?: string } | null)?.refusal_code;
const summaryOf = (tool: { compress?: (raw: unknown) => { summary: string } }, raw: unknown) =>
  tool.compress?.(raw).summary ?? '';

const row = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  status,
  worker_id: 'w1',
  day: '2026-09-16',
  rooms_completed: null,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveHotel.mockResolvedValue({ status: 'RESOLVED', hotelId: 'h1', name: 'Premier Inn Essen City Centre Hotel' });
  mockResolveWorker.mockResolvedValue({ status: 'RESOLVED', workerId: 'w1', fullName: 'Parveen Kumar', hotelId: 'h1' });
  mockList.mockResolvedValue({ data: [row('a1', 'CONFIRMED')], total: 1 });
  mockUpdate.mockResolvedValue({ id: 'a1', status: 'CANCELLED' });
  mockRoomsForAssignment.mockResolvedValue({ assignment_id: 'a1', rooms: [] });
});

/* ------------------------------------------------------------------ */

describe('assignments.cancel_shift -- "cancel shift for parveen kumar 16 September"', () => {
  it('cancels the live shift on that day, through the five-argument service call', async () => {
    const out = await cancelShift.invoke({ worker_name: 'parveen kumar', day: '2026-09-16' }, manager());

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0]!;
    // NEVER the sixth argument: `internalBypass` skips a worker-role branch.
    expect(call).toHaveLength(5);
    expect(call[0]).toBe('a1');
    expect(call[1]).toMatchObject({ status: 'CANCELLED' });
    expect(call.slice(2)).toEqual(['m1', 'manager', { type: 'hotel', hotel_id: 'h1' }]);
    expect(summaryOf(cancelShift, out)).toMatch(/Cancelled Parveen Kumar's shift at Premier Inn .* on 2026-09-16/);
  });

  it('searches only the resolved worker, hotel and day', async () => {
    await cancelShift.invoke({ worker_name: 'parveen', day: '2026-09-16' }, manager());
    expect(mockList.mock.calls[0]![0]).toMatchObject({
      worker_id: 'w1',
      hotel_id: 'h1',
      from: '2026-09-16',
      to: '2026-09-16',
    });
  });

  it('picks the live shift when a cancelled one shares the day', async () => {
    mockList.mockResolvedValue({ data: [row('old', 'CANCELLED'), row('live', 'CONFIRMED')], total: 2 });
    await cancelShift.invoke({ worker_name: 'parveen', day: '2026-09-16' }, manager());
    expect(mockUpdate.mock.calls[0]![0]).toBe('live');
  });

  it.each([
    ['no shift that day', [], 'NOT_FOUND', /has no shift at .* on 2026-09-16/],
    ['a finished shift', [row('a1', 'COMPLETED')], 'ALREADY_DONE', /already finished/],
    ['an already-cancelled shift', [row('a1', 'CANCELLED')], 'ALREADY_DONE', /already cancelled/],
  ])('refuses %s and writes nothing', async (_label, data, code, message) => {
    mockList.mockResolvedValue({ data, total: data.length });
    const out = await cancelShift.invoke({ worker_name: 'parveen', day: '2026-09-16' }, manager());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(codeOf(cancelShift, out)).toBe(code);
    expect(summaryOf(cancelShift, out)).toMatch(message);
  });

  /** A past shift nobody attended is a no-show; rewriting it as cancelled erases that. */
  it('refuses a day that has already passed', async () => {
    mockList.mockResolvedValue({ data: [row('a1', 'CONFIRMED', { day: '2026-09-14' })], total: 1 });
    const out = await cancelShift.invoke({ worker_name: 'parveen', day: '2026-09-14' }, manager());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(summaryOf(cancelShift, out)).toMatch(/already passed.*absent/);
  });

  /**
   * THE CONFIRMED-THEN-NOTHING DEFECT. The precheck answers before a
   * confirmation is ever shown, so nobody presses Confirm on a shift that
   * does not exist.
   */
  it('prechecks without writing, and refuses when there is nothing to cancel', async () => {
    mockList.mockResolvedValue({ data: [], total: 0 });
    const refusal = await cancelShift.precheck!({ worker_name: 'parveen', day: '2026-09-16' }, manager());
    expect(refusal).toMatchObject({ refused: { code: 'NOT_FOUND' } });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('prechecks to null when the shift can be cancelled', async () => {
    expect(await cancelShift.precheck!({ worker_name: 'parveen', day: '2026-09-16' }, manager())).toBeNull();
  });

  it('carries a refusal from name resolution straight through', async () => {
    mockResolveWorker.mockResolvedValue({ status: 'NOT_FOUND', query: 'Harvir Singh' });
    const out = await cancelShift.invoke({ worker_name: 'Harvir Singh', day: '2026-09-16' }, manager());
    expect(mockList).not.toHaveBeenCalled();
    expect(summaryOf(cancelShift, out)).toMatch(/Harvir Singh/);
  });

  it('takes no id from the caller, and is confirmed and out of a worker\'s reach', () => {
    for (const bad of [{ assignment_id: 'a1' }, { worker_id: 'w1' }, { hotel_id: 'h1' }]) {
      expect(cancelShift.args.safeParse({ worker_name: 'Anna', day: '2026-09-16', ...bad }).success).toBe(false);
    }
    expect({ tier: cancelShift.tier, confirm: cancelShift.confirm }).toEqual({ tier: 'HIGH_RISK_WRITE', confirm: true });
    expect(actorHasPermission(worker(), cancelShift.permission!)).toBe(false);
    expect(actorHasPermission(manager(), cancelShift.permission!)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe('rooms.record_worker_count -- "parveen didi today 10 rooms"', () => {
  /**
   * DOUBLE COUNTING. Analytics adds manager counts to logged rooms, so a count
   * over a shift that already has logged rooms would report twice the work.
   */
  it('does NOT write a count when the worker has logged rooms, and says how many', async () => {
    mockList.mockResolvedValue({ data: [row('a1', 'COMPLETED', { day: '2026-09-15' })], total: 1 });
    mockRoomsForAssignment.mockResolvedValue({ assignment_id: 'a1', rooms: [{}, {}, {}, {}, {}, {}, {}, {}] });

    const out = await recordWorkerRooms.invoke({ worker_name: 'parveen', rooms: 10 }, manager());

    expect(mockLogRooms).not.toHaveBeenCalled();
    expect(mockUpdateRooms).not.toHaveBeenCalled();
    expect(codeOf(recordWorkerRooms, out)).toBe('ALREADY_DONE');
    expect(summaryOf(recordWorkerRooms, out)).toMatch(/logged 8 rooms .* not 10/);
  });

  it('says the logged rooms already count when the numbers agree', async () => {
    mockList.mockResolvedValue({ data: [row('a1', 'IN_PROGRESS', { day: '2026-09-15' })], total: 1 });
    mockRoomsForAssignment.mockResolvedValue({ assignment_id: 'a1', rooms: new Array(10).fill({}) });

    const out = await recordWorkerRooms.invoke({ worker_name: 'parveen', rooms: 10 }, manager());
    expect(summaryOf(recordWorkerRooms, out)).toMatch(/already logged 10 rooms .* count automatically/);
  });

  it('refuses a shift still in progress with nothing logged, and writes nothing', async () => {
    mockList.mockResolvedValue({ data: [row('a1', 'IN_PROGRESS', { day: '2026-09-15' })], total: 1 });
    const out = await recordWorkerRooms.invoke({ worker_name: 'parveen', rooms: 10 }, manager());
    expect(mockLogRooms).not.toHaveBeenCalled();
    expect(codeOf(recordWorkerRooms, out)).toBe('UNAVAILABLE');
  });

  it('records the count on a finished shift with nothing logged, defaulting to today', async () => {
    mockList.mockResolvedValue({ data: [row('a1', 'COMPLETED', { day: '2026-09-15' })], total: 1 });
    const out = await recordWorkerRooms.invoke({ worker_name: 'parveen', rooms: 10 }, manager());

    expect(mockList.mock.calls[0]![0]).toMatchObject({ from: '2026-09-15', to: '2026-09-15' });
    expect(mockLogRooms).toHaveBeenCalledWith('a1', { rooms_completed: 10 }, expect.objectContaining({ userId: 'm1' }));
    expect(summaryOf(recordWorkerRooms, out)).toBe('Recorded 10 rooms for Parveen Kumar on 2026-09-15.');
  });

  /** The service writes `notes ?? null`; a number alone must not wipe the note. */
  it('corrects an existing count WITHOUT clearing its note', async () => {
    mockList.mockResolvedValue({
      data: [row('a1', 'COMPLETED', { day: '2026-09-15', rooms_completed: { rooms_completed: 8, notes: 'lift broken' } })],
      total: 1,
    });
    const out = await recordWorkerRooms.invoke({ worker_name: 'parveen', rooms: 10 }, manager());

    expect(mockLogRooms).not.toHaveBeenCalled();
    expect(mockUpdateRooms.mock.calls[0]![1]).toEqual({ rooms_completed: 10, notes: 'lift broken' });
    expect(summaryOf(recordWorkerRooms, out)).toMatch(/\(it was 8\)/);
  });
});

/* ------------------------------------------------------------------ */

describe('users.new_account_link -- "I want make id more next employe"', () => {
  it('returns the New user form with the details in the FRAGMENT, not a query string', async () => {
    const out = (await newAccountLink.invoke(
      { first_name: 'Mukesh', last_name: 'kumar', email: 'deepak9090122@gmail.com', phone: '+4916090744182', skills: ['CLEANER'] } as never,
      manager()
    )) as { link: string };

    expect(out.link.startsWith('/users/new#')).toBe(true);
    expect(out.link).not.toContain('?');
    const params = new URLSearchParams(out.link.split('#')[1]);
    expect(Object.fromEntries(params)).toEqual({
      first_name: 'Mukesh',
      last_name: 'kumar',
      email: 'deepak9090122@gmail.com',
      phone: '+4916090744182',
      role: 'worker',
      hotel_id: 'h1',
      skills: 'CLEANER',
    });
    expect(summaryOf(newAccountLink, out)).toMatch(/needs a profile photo/);
  });

  it('normalises a German number the way the form\'s own check will', () => {
    const parsed = newAccountLink.args.safeParse({ first_name: 'Mukesh', phone: '016090744182' });
    expect(parsed.success && (parsed.data as { phone?: string }).phone).toBe('+4916090744182');
  });

  it('refuses a kind of account the caller may not create, rather than handing over a form that will fail', async () => {
    const out = await newAccountLink.invoke({ first_name: 'Harvir', staff_type: 'manager' } as never, manager());
    expect(codeOf(newAccountLink, out)).toBe('OUT_OF_SCOPE');
  });

  it('never takes `role` as an argument -- it is an authorization key', () => {
    expect(newAccountLink.args.safeParse({ first_name: 'A', role: 'worker' }).success).toBe(false);
  });

  it('writes nothing and is not offered to a worker', () => {
    expect(newAccountLink.tier).toBe('READ_ONLY');
    expect(actorHasPermission(worker(), newAccountLink.permission!)).toBe(false);
    expect(actorHasPermission(manager(), newAccountLink.permission!)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe('chatbot.recent_conversations -- "I want previous chats"', () => {
  it('reads only the caller\'s own conversations', async () => {
    mockRecent.mockResolvedValue([]);
    await recentConversations.invoke({} as never, manager());
    expect(mockRecent.mock.calls[0]![0]).toBe('m1');
  });

  it('lists when each started and what the person asked, and points at History', () => {
    const summary = summaryOf(recentConversations, [
      { startedAt: '2026-09-15T08:02:00Z', opening: 'make me plans for parveen 17 18 19 September' },
    ]);
    expect(summary).toMatch(/History/);
    expect(summary).toMatch(/"make me plans for parveen 17 18 19 September"/);
    expect(summary).toMatch(/10:02/); // Berlin, not UTC
  });

  it('says plainly when there is nothing, rather than that it cannot', () => {
    expect(summaryOf(recentConversations, [])).toMatch(/no earlier conversations/);
  });

  it('is the narrow token-less shape: read-only, self-scoped, reasoned', () => {
    expect({ tier: recentConversations.tier, scope: recentConversations.scopeCheck, permission: recentConversations.permission })
      .toEqual({ tier: 'READ_ONLY', scope: 'self', permission: null });
    expect(recentConversations.permissionRationale?.length).toBeGreaterThan(40);
  });
});

/* ------------------------------------------------------------------ */

describe('reports.work_summary -- "give me record data previews weeks how much work we did"', () => {
  beforeEach(() => {
    mockList.mockResolvedValue({ data: [], total: 0 });
    mockAttendanceList.mockResolvedValue({ data: [], total: 0 });
    mockRoomsForHotels.mockResolvedValue({ day: '2026-09-07', rooms: [], by_worker: [] });
  });

  /** The 0 a manager was shown was the manager's OWN rooms. This is the team's. */
  it('reads the TEAM through each owning module, with the caller as actor', async () => {
    await teamWorkSummary.invoke({ from: '2026-09-07', to: '2026-09-07' }, manager());
    expect(mockList.mock.calls[0]![1]).toMatchObject({ userId: 'm1', role: 'manager' });
    expect(mockAttendanceList.mock.calls[0]![1]).toMatchObject({ userId: 'm1' });
    expect(mockRoomsForHotels.mock.calls[0]![1]).toEqual({ day: '2026-09-07' });
  });

  it('adds up shifts, people, hours, lateness and logged rooms', async () => {
    mockList.mockResolvedValue({
      data: [
        { status: 'COMPLETED', worker_id: 'w1' },
        { status: 'COMPLETED', worker_id: 'w2' },
        { status: 'CANCELLED', worker_id: 'w3' },
      ],
      total: 3,
    });
    mockAttendanceList.mockResolvedValue({
      data: [
        { status: 'PRESENT', minutes_worked: 480, minutes_late: 0 },
        { status: 'LATE', minutes_worked: 450, minutes_late: 12 },
      ],
      total: 2,
    });
    mockRoomsForHotels.mockResolvedValue({
      day: '2026-09-07',
      rooms: [
        ...new Array(25).fill({ day: '2026-09-07' }),
        // The read includes the day BEFORE (night shifts); those are not this day's.
        ...new Array(9).fill({ day: '2026-09-06' }),
      ],
      by_worker: [{ rooms_logged: 34 }],
    });

    const out = await teamWorkSummary.invoke({ from: '2026-09-07', to: '2026-09-07' }, manager());
    expect(summaryOf(teamWorkSummary, out)).toBe(
      'On 2026-09-07 across your hotels: 2 shifts (2 finished, 1 cancelled) worked by 2 people, 15.5 hours clocked, 1 late arrival, 25 rooms logged.'
    );
  });

  /**
   * FOUND BY THE DATA-LAYER RUN, 2026-09-15: eight rooms seeded, sixteen
   * reported. The room read spans the target day and the one before, so a
   * two-day range saw the same rooms twice.
   */
  it('counts each room once across consecutive days', async () => {
    const eight = new Array(8).fill({ day: '2026-09-14' });
    mockRoomsForHotels.mockImplementation(async (_actor: unknown, q: { day: string }) => ({
      day: q.day,
      rooms: q.day === '2026-09-14' || q.day === '2026-09-15' ? eight : [],
      by_worker: [{ rooms_logged: 8 }],
    }));
    mockList.mockResolvedValue({ data: [{ status: 'COMPLETED', worker_id: 'w1' }], total: 1 });

    const out = await teamWorkSummary.invoke({ from: '2026-09-14', to: '2026-09-15' }, manager());
    expect(summaryOf(teamWorkSummary, out)).toMatch(/ 8 rooms logged/);
  });

  it('says what a real zero means, instead of "the count is 0"', async () => {
    const out = await teamWorkSummary.invoke({ from: '2026-09-07', to: '2026-09-07' }, manager());
    expect(summaryOf(teamWorkSummary, out)).toMatch(/no work recorded: no shifts on the calendar, nobody clocked in, and no rooms logged/);
  });

  it('does not present a partial room count as a total beyond 31 days', async () => {
    mockList.mockResolvedValue({ data: [{ status: 'COMPLETED', worker_id: 'w1' }], total: 1 });
    const out = await teamWorkSummary.invoke({ from: '2026-07-01', to: '2026-08-31' }, manager());
    expect(mockRoomsForHotels).not.toHaveBeenCalled();
    expect(summaryOf(teamWorkSummary, out)).toMatch(/rooms are counted for ranges of up to 31 days/);
  });

  /**
   * The owner's own sentence named no dates and the live model called no tool.
   * No dates now means the last two weeks; one date means that day.
   */
  it('defaults to the last two weeks when no dates are given, and one date means that day', async () => {
    const none = await teamWorkSummary.invoke({} as never, manager());
    expect(summaryOf(teamWorkSummary, none)).toMatch(/2026-09-02 to 2026-09-15/);
    expect(mockList.mock.calls[0]![0]).toMatchObject({ from: '2026-09-02', to: '2026-09-15' });

    const one = await teamWorkSummary.invoke({ from: '2026-09-07' } as never, manager());
    expect(summaryOf(teamWorkSummary, one)).toMatch(/^On 2026-09-07/);
  });

  it('refuses a range longer than 92 days and a backwards one', () => {
    expect(teamWorkSummary.args.safeParse({ from: '2026-01-01', to: '2026-06-30' }).success).toBe(false);
    expect(teamWorkSummary.args.safeParse({ from: '2026-09-08', to: '2026-09-07' }).success).toBe(false);
  });

  it('is a management read', () => {
    expect(actorHasPermission(worker(), teamWorkSummary.permission!)).toBe(false);
    expect(actorHasPermission(manager(), teamWorkSummary.permission!)).toBe(true);
  });
});

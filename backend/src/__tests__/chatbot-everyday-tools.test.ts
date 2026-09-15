import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * The everyday tools of 2026-09-15, found by mapping every platform route
 * against the registry. As elsewhere, most of what is asserted is what each
 * one refuses -- the wrong room edited, a past absence erased, a request
 * nobody named cancelled along with the people booked on it.
 */

const mockMyRooms = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockUpdateRoom = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockDeleteRoom = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockForHotels = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockListAbsences = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockDeleteAbsence = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockListRequests = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockUpdateRequest = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveHotel = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveWorker = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/rooms/service.js', () => ({
  roomService: { listMyRooms: mockMyRooms, updateRoom: mockUpdateRoom, deleteRoom: mockDeleteRoom, listRoomsForHotels: mockForHotels },
}));
jest.mock('../modules/calendar/service.js', () => ({
  calendarService: { listAbsences: mockListAbsences, deleteAbsence: mockDeleteAbsence },
}));
jest.mock('../modules/job-requests/service.js', () => ({
  jobRequestService: { list: mockListRequests, update: mockUpdateRequest },
}));
jest.mock('../modules/chatbot/tools/definitions/daily-operations.tools.js', () => ({ todayIso: () => '2026-09-15' }));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveHotelReference: mockResolveHotel,
  resolveWorkerReference: mockResolveWorker,
  refuseUnresolved: (r: any) => ({ refused: { code: 'NOT_FOUND', message: `No worker matching "${r.query}" is on your team.`, nextAction: 'ask_user' } }),
  refuseUnresolvedHotel: () => ({ refused: { code: 'NOT_FOUND', message: 'no hotel', nextAction: 'ask_user' } }),
}));

import {
  cancelTeamRequest,
  fixMyRoom,
  listTeamRequests,
  teamRoomsToday,
  withdrawWorkerAbsence,
} from '../modules/chatbot/tools/definitions/everyday.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorOf = (role: 'worker' | 'manager' | 'checker'): ActorContext =>
  ({
    userId: `${role}1`,
    role,
    permissions: ROLE_PERMISSIONS[role.toUpperCase()] ?? [],
    scope: role === 'manager' ? { type: 'hotel', hotel_id: 'h1' } : null,
  }) as unknown as ActorContext;

const summaryOf = (tool: { compress?: (raw: unknown) => { summary: string } }, raw: unknown) => tool.compress?.(raw).summary ?? '';
const codeOf = (tool: { compress?: (raw: unknown) => { data: unknown } }, raw: unknown) =>
  (tool.compress?.(raw).data as { refusal_code?: string } | null)?.refusal_code;

const room = (id: string, number: string, day = '2026-09-15', editable = true) => ({ id, room_number: number, day, editable, worker_name: 'Parveen Kumar' });

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveHotel.mockResolvedValue({ status: 'RESOLVED', hotelId: 'h1', name: 'Hotel Adler' });
  mockResolveWorker.mockResolvedValue({ status: 'RESOLVED', workerId: 'w2', fullName: 'Anna Braun', hotelId: 'h1' });
  mockMyRooms.mockResolvedValue({ rooms: [room('r1', '214'), room('r0', '214', '2026-09-14')], needs_rework: [] });
  mockListAbsences.mockResolvedValue([{ id: 'ab1', worker_id: 'w2', day: '2026-09-16', kind: 'SICK' }]);
  mockListRequests.mockResolvedValue({ data: [], total: 0 });
});

describe('rooms.fix_my_room -- "I logged 214 but it was 241"', () => {
  it("changes today's entry, not yesterday's entry with the same number", async () => {
    const out = await fixMyRoom.invoke({ room_number: '214', new_room_number: '241' }, actorOf('worker'));
    expect(mockUpdateRoom.mock.calls[0]!.slice(0, 2)).toEqual(['r1', '241']);
    expect(summaryOf(fixMyRoom, out)).toBe('Room 214 is now room 241 in your log for 2026-09-15.');
  });

  it('removes the entry when no new number is given', async () => {
    const out = await fixMyRoom.invoke({ room_number: '214' }, actorOf('worker'));
    expect(mockDeleteRoom.mock.calls[0]![0]).toBe('r1');
    expect(summaryOf(fixMyRoom, out)).toMatch(/Removed room 214/);
  });

  it('refuses before confirming when the room is not in the log, or already inspected', async () => {
    expect(await fixMyRoom.precheck!({ room_number: '999' }, actorOf('worker'))).toMatchObject({ refused: { code: 'NOT_FOUND' } });
    mockMyRooms.mockResolvedValue({ rooms: [room('r1', '214', '2026-09-15', false)], needs_rework: [] });
    expect(await fixMyRoom.precheck!({ room_number: '214' }, actorOf('worker'))).toMatchObject({ refused: { code: 'ALREADY_DONE' } });
    expect(mockUpdateRoom).not.toHaveBeenCalled();
    expect(mockDeleteRoom).not.toHaveBeenCalled();
  });

  it('turns "already logged" into a stop, not a failure', async () => {
    mockUpdateRoom.mockRejectedValue(new Error('Room 241 was already logged today'));
    const out = await fixMyRoom.invoke({ room_number: '214', new_room_number: '241' }, actorOf('worker'));
    expect(codeOf(fixMyRoom, out)).toBe('ALREADY_DONE');
  });

  it('rejects changing a room to the same number, and is self-scoped', () => {
    expect(fixMyRoom.args.safeParse({ room_number: '214', new_room_number: ' 214 ' }).success).toBe(false);
    expect(fixMyRoom.scopeCheck).toBe('self');
    expect(actorHasPermission(actorOf('checker'), fixMyRoom.permission!)).toBe(false);
  });
});

describe('rooms.team_today -- "how many rooms has everyone done today"', () => {
  it("counts each worker's rooms for the day only, most first", async () => {
    mockForHotels.mockResolvedValue({
      rooms: [
        { day: '2026-09-15', worker_name: 'Anna Braun' },
        { day: '2026-09-15', worker_name: 'Parveen Kumar' },
        { day: '2026-09-15', worker_name: 'Parveen Kumar' },
        // The read includes yesterday (night shifts); not today's work.
        { day: '2026-09-14', worker_name: 'Anna Braun' },
      ],
      by_worker: [],
    });
    const out = await teamRoomsToday.invoke({}, actorOf('manager'));
    expect(summaryOf(teamRoomsToday, out)).toBe('Rooms logged today: Parveen Kumar 2, Anna Braun 1 (3 in total).');
  });

  it('says plainly when nothing is logged yet', async () => {
    mockForHotels.mockResolvedValue({ rooms: [], by_worker: [] });
    expect(summaryOf(teamRoomsToday, await teamRoomsToday.invoke({}, actorOf('manager')))).toBe('No rooms have been logged today yet.');
  });

  it('is kept out of a worker\'s manifest even though workers hold rooms:read', () => {
    expect(actorHasPermission(actorOf('worker'), teamRoomsToday.permission!)).toBe(false);
    expect(actorHasPermission(actorOf('manager'), teamRoomsToday.permission!)).toBe(true);
  });
});

describe('calendar.withdraw_worker_absence -- "Anna is better, she is not off tomorrow"', () => {
  it('deletes that worker\'s absence on that day, and says the shift is not restored', async () => {
    const out = await withdrawWorkerAbsence.invoke({ worker_name: 'anna', day: '2026-09-16' }, actorOf('manager'));
    expect(mockListAbsences.mock.calls[0]![0]).toMatchObject({ from: '2026-09-16', to: '2026-09-16', worker_id: 'w2' });
    expect(mockDeleteAbsence.mock.calls[0]![0]).toBe('ab1');
    expect(summaryOf(withdrawWorkerAbsence, out)).toMatch(/Anna Braun's sick day on 2026-09-16 is withdrawn\. Any shift it cancelled is not restored/);
  });

  it('refuses a past day and a day with no absence, before confirming', async () => {
    expect(await withdrawWorkerAbsence.precheck!({ worker_name: 'anna', day: '2026-09-10' }, actorOf('manager'))).toMatchObject({ refused: { code: 'ALREADY_DONE' } });
    mockListAbsences.mockResolvedValue([]);
    expect(await withdrawWorkerAbsence.precheck!({ worker_name: 'anna', day: '2026-09-17' }, actorOf('manager'))).toMatchObject({ refused: { code: 'NOT_FOUND' } });
    expect(mockDeleteAbsence).not.toHaveBeenCalled();
  });

  it('ignores an absence belonging to someone else', async () => {
    mockListAbsences.mockResolvedValue([{ id: 'other', worker_id: 'w9', day: '2026-09-16', kind: 'SICK' }]);
    const out = await withdrawWorkerAbsence.invoke({ worker_name: 'anna', day: '2026-09-16' }, actorOf('manager'));
    expect(mockDeleteAbsence).not.toHaveBeenCalled();
    expect(codeOf(withdrawWorkerAbsence, out)).toBe('NOT_FOUND');
  });

  it('is confirmed and out of a worker\'s reach', () => {
    expect({ tier: withdrawWorkerAbsence.tier, confirm: withdrawWorkerAbsence.confirm }).toEqual({ tier: 'HIGH_RISK_WRITE', confirm: true });
    expect(actorHasPermission(actorOf('worker'), withdrawWorkerAbsence.permission!)).toBe(false);
  });
});

describe('staffing requests -- list and cancel', () => {
  const req = (id: string, position: string, day = '2026-09-19', status = 'OPEN') => ({
    id, position, workers_needed: 3, shift_date: day, shift_start_time: '07:00', shift_end_time: '15:00', status,
  });

  it('lists live requests from today on, soonest first, without ids', async () => {
    mockListRequests.mockResolvedValue({ data: [req('j2', 'waiter', '2026-09-20'), req('j1', 'cleaner'), req('old', 'cleaner', '2026-09-01')], total: 3 });
    const out = await listTeamRequests.invoke({}, actorOf('manager'));
    const summary = summaryOf(listTeamRequests, out);
    expect(summary).toBe('2 open staffing requests:\n• 2026-09-19 07:00-15:00: 3 x cleaner (open)\n• 2026-09-20 07:00-15:00: 3 x waiter (open)');
    expect(summary).not.toMatch(/j1|j2/);
  });

  it('cancels the one request that matches day and position', async () => {
    mockListRequests.mockResolvedValue({ data: [req('j1', 'cleaner'), req('j2', 'waiter')], total: 2 });
    const out = await cancelTeamRequest.invoke({ shift_date: '2026-09-19', position: 'Cleaner' }, actorOf('manager'));
    expect(mockUpdateRequest.mock.calls[0]!.slice(0, 2)).toEqual(['j1', expect.objectContaining({ status: 'CANCELLED' })]);
    expect(summaryOf(cancelTeamRequest, out)).toMatch(/Cancelled the staffing request 2026-09-19 .* cleaner .* no longer booked/);
  });

  /** Cancelling un-books whoever took it; guessing between two is not acceptable. */
  it('refuses and lists them when several requests share the day', async () => {
    mockListRequests.mockResolvedValue({ data: [req('j1', 'cleaner'), req('j2', 'waiter')], total: 2 });
    const refusal = await cancelTeamRequest.precheck!({ shift_date: '2026-09-19' }, actorOf('manager'));
    expect(refusal).toMatchObject({ refused: { code: 'AMBIGUOUS', message: expect.stringMatching(/cleaner.*waiter/) } });
    expect(mockUpdateRequest).not.toHaveBeenCalled();
  });

  it('refuses when nothing matches', async () => {
    const refusal = await cancelTeamRequest.precheck!({ shift_date: '2026-09-19', position: 'waiter' }, actorOf('manager'));
    expect(refusal).toMatchObject({ refused: { code: 'NOT_FOUND' } });
  });

  it('both are management tools; cancelling is confirmed', () => {
    for (const tool of [listTeamRequests, cancelTeamRequest]) {
      expect(actorHasPermission(actorOf('worker'), tool.permission!)).toBe(false);
      expect(actorHasPermission(actorOf('manager'), tool.permission!)).toBe(true);
    }
    expect(cancelTeamRequest.confirm).toBe(true);
  });
});

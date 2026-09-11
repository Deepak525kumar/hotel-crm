import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * The four planning tools, from the 2026-09-09 route-by-route gap analysis.
 *
 * The properties under test are the ones that make a team-scoped tool safe and
 * useful: no identifier is ever an argument, the day asked about is the day
 * answered, a broadcast is never published, and a roster answer carries names
 * and roles but no contact details.
 */

const mockGetAvailability = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockAttendanceList = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockCreateRequest = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockListUsers = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveHotel = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveWorker = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/calendar/service.js', () => ({
  calendarService: { getAvailability: mockGetAvailability },
}));
jest.mock('../modules/attendance/service.js', () => ({
  attendanceService: { list: mockAttendanceList },
}));
jest.mock('../modules/job-requests/service.js', () => ({
  jobRequestService: { create: mockCreateRequest },
}));
jest.mock('../modules/users/service.js', () => ({
  userService: { listUsers: mockListUsers },
}));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveHotelReference: mockResolveHotel,
  resolveWorkerReference: mockResolveWorker,
  refuseUnresolved: (r: { status: string }) => ({
    refused: { code: r.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'NOT_FOUND', message: 'unresolved', nextAction: 'ask_user' },
  }),
  refuseUnresolvedHotel: () => ({
    refused: { code: 'NOT_FOUND', message: 'no hotel', nextAction: 'ask_user' },
  }),
  describeUnresolved: () => 'unresolved',
}));

import {
  checkAvailability,
  createBroadcast,
  teamStatus,
  findTeamMember,
} from '../modules/chatbot/tools/definitions/planning.tools.js';
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

const codeOf = (tool: { compress?: (r: unknown) => { data: unknown } }, raw: unknown) =>
  (tool.compress?.(raw).data as { refusal_code?: string } | null)?.refusal_code;
const summaryOf = (tool: { compress?: (r: unknown) => { summary: string } }, raw: unknown) =>
  tool.compress?.(raw).summary ?? '';

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveHotel.mockResolvedValue({ status: 'RESOLVED', hotelId: 'h1', name: 'Hotel Adler' });
  mockResolveWorker.mockResolvedValue({ status: 'RESOLVED', workerId: 'w1', fullName: 'Anna Braun' });
  mockGetAvailability.mockResolvedValue({ worker_id: 'w1', day: '2026-09-17', available: true });
  mockAttendanceList.mockResolvedValue({ data: [], total: 0 });
  mockCreateRequest.mockResolvedValue({
    id: 'jr1',
    position: 'Cleaner',
    workers_needed: 3,
    shift_date: '2026-09-17',
    status: 'DRAFT',
  });
  mockListUsers.mockResolvedValue({
    data: [{ full_name: 'Anna Braun', role: 'WORKER', email: 'anna@example.com' }],
    total: 1,
  });
});

describe('no identifier is ever an argument', () => {
  it.each([
    ['calendar.check_availability', () => checkAvailability],
    ['job_requests.create_broadcast', () => createBroadcast],
    ['attendance.team_status', () => teamStatus],
    ['users.find_team_member', () => findTeamMember],
  ])('%s refuses ids and authorization inputs', (_name, get) => {
    const tool = get();
    for (const bad of [
      { worker_id: 'w2' },
      { hotel_id: 'h2' },
      { userId: 'm2' },
      { role: 'admin' },
    ]) {
      expect(tool.args.safeParse(bad).success).toBe(false);
    }
  });
});

describe('no worker can reach any of them', () => {
  it.each([
    ['calendar.check_availability', () => checkAvailability],
    ['job_requests.create_broadcast', () => createBroadcast],
    ['attendance.team_status', () => teamStatus],
    ['users.find_team_member', () => findTeamMember],
  ])('%s is out of a worker\'s reach', (_name, get) => {
    const tool = get();
    const worker = { role: 'worker', permissions: ROLE_PERMISSIONS.WORKER ?? [] } as never;
    expect({ tool: tool.name, reachable: actorHasPermission(worker, tool.permission!) }).toEqual({
      tool: tool.name,
      reachable: false,
    });
  });
});

describe('calendar.check_availability', () => {
  /**
   * The reason the service was changed rather than the tool fudged: until
   * 2026-09-09 getAvailability was today-only, so a tool that took a date
   * would have answered about today while appearing to answer about Thursday.
   */
  it('passes the day through to the service, rather than answering about today', async () => {
    await checkAvailability.invoke({ worker_name: 'Anna', day: '2026-09-17' } as never, manager());

    const [workerId, , day] = mockGetAvailability.mock.calls[0] as [string, unknown, string];
    expect({ workerId, day }).toEqual({ workerId: 'w1', day: '2026-09-17' });
  });

  it('resolves the worker from a NAME inside the actor\'s own hotel', async () => {
    await checkAvailability.invoke({ worker_name: 'Anna', day: '2026-09-17' } as never, manager());
    const [name, , hotelId] = mockResolveWorker.mock.calls[0] as [string, unknown, string];
    expect({ name, hotelId }).toEqual({ name: 'Anna', hotelId: 'h1' });
  });

  it('refuses an ambiguous name instead of guessing a worker', async () => {
    mockResolveWorker.mockResolvedValue({ status: 'AMBIGUOUS', candidates: ['a', 'b'] });
    const out = await checkAvailability.invoke(
      { worker_name: 'Anna', day: '2026-09-17' } as never,
      manager()
    );
    expect(mockGetAvailability).not.toHaveBeenCalled();
    expect(codeOf(checkAvailability, out)).toBe('AMBIGUOUS');
  });

  it('says who and which day in the answer, so it cannot be misread', async () => {
    const out = await checkAvailability.invoke(
      { worker_name: 'Anna', day: '2026-09-17' } as never,
      manager()
    );
    expect(summaryOf(checkAvailability, out)).toMatch(/Anna Braun.*2026-09-17/);
  });

  /** Why someone is unavailable is their business, not the manager's chatbot's. */
  it('does not disclose WHY an unavailable worker is unavailable', async () => {
    mockGetAvailability.mockResolvedValue({ worker_id: 'w1', day: '2026-09-17', available: false });
    const out = await checkAvailability.invoke(
      { worker_name: 'Anna', day: '2026-09-17' } as never,
      manager()
    );
    const summary = summaryOf(checkAvailability, out);
    expect(summary).toMatch(/not free/i);
    expect(summary).not.toMatch(/sick|vacation|krank|urlaub/i);
  });

  it('rejects an impossible date before calling anything', () => {
    expect(checkAvailability.args.safeParse({ worker_name: 'Anna', day: '2026-02-30' }).success).toBe(false);
  });

  it('reads without writing: READ_ONLY and no confirmation', () => {
    expect({ tier: checkAvailability.tier, confirm: checkAvailability.confirm }).toEqual({
      tier: 'READ_ONLY',
      confirm: false,
    });
  });
});

describe('job_requests.create_broadcast', () => {
  /**
   * IT CREATES THE REQUEST OPEN, and the history is worth keeping.
   *
   * This test used to assert the opposite, on a justification that was simply
   * false: that publishing "notifies every eligible worker -- push and email
   * to hundreds". `create()` enqueues nothing; the fan-out belongs to a
   * different method. What the DRAFT actually bought was a confirmed action
   * that did half the job and told the manager to go and finish it elsewhere,
   * which makes the confirmation meaningless.
   *
   * `status` is still not an argument -- the manager confirmed a staffing
   * request, not a decision about workflow state.
   */
  it('creates the request OPEN, and does not accept a status argument', async () => {
    await createBroadcast.invoke(
      {
        position: 'Cleaner',
        workers_needed: 3,
        shift_date: '2026-09-17',
        shift_start_time: '08:00',
        shift_end_time: '16:00',
      } as never,
      manager()
    );

    const [input] = mockCreateRequest.mock.calls[0] as [Record<string, unknown>];
    expect(input.status).toBe('OPEN');
    expect(createBroadcast.args.safeParse({
      position: 'Cleaner',
      workers_needed: 1,
      shift_date: '2026-09-17',
      shift_start_time: '08:00',
      shift_end_time: '16:00',
      status: 'DRAFT',
    }).success).toBe(false);
  });

  /**
   * The reply must say the thing HAPPENED. It previously said the opposite --
   * "it has NOT been sent, publish it from the app" -- after the manager had
   * already approved it.
   */
  it('tells the manager the request is live, not that it still needs doing', async () => {
    const out = await createBroadcast.invoke(
      {
        position: 'Cleaner',
        workers_needed: 3,
        shift_date: '2026-09-17',
        shift_start_time: '08:00',
        shift_end_time: '16:00',
      } as never,
      manager()
    );
    const summary = summaryOf(createBroadcast, out);
    expect(summary).toMatch(/open for workers/i);
    expect(summary).not.toMatch(/draft|not been sent|publish it/i);
  });

  it('takes the hotel from the actor\'s scope, never from an argument', async () => {
    await createBroadcast.invoke(
      {
        position: 'Cleaner',
        workers_needed: 3,
        shift_date: '2026-09-17',
        shift_start_time: '08:00',
        shift_end_time: '16:00',
      } as never,
      manager()
    );
    const [input] = mockCreateRequest.mock.calls[0] as [Record<string, unknown>];
    expect(input.hotel_id).toBe('h1'); // from resolveHotelReference, not the model
  });

  it('refuses a shift that ends before it starts, writing nothing', async () => {
    const out = await createBroadcast.invoke(
      {
        position: 'Cleaner',
        workers_needed: 3,
        shift_date: '2026-09-17',
        shift_start_time: '16:00',
        shift_end_time: '08:00',
      } as never,
      manager()
    );
    expect(mockCreateRequest).not.toHaveBeenCalled();
    expect(codeOf(createBroadcast, out)).toBe('NEEDS_INPUT');
  });

  it('rejects a malformed time and an absurd headcount at the schema', () => {
    const base = {
      position: 'Cleaner',
      workers_needed: 3,
      shift_date: '2026-09-17',
      shift_start_time: '08:00',
      shift_end_time: '16:00',
    };
    expect(createBroadcast.args.safeParse({ ...base, shift_start_time: '25:00' }).success).toBe(false);
    expect(createBroadcast.args.safeParse({ ...base, shift_start_time: '8am' }).success).toBe(false);
    expect(createBroadcast.args.safeParse({ ...base, workers_needed: 0 }).success).toBe(false);
    expect(createBroadcast.args.safeParse({ ...base, workers_needed: 5000 }).success).toBe(false);
  });

  /** Pay is a term of employment; it is not set from a dictated sentence. */
  it('exposes no pay, currency or requirements field', () => {
    const base = {
      position: 'Cleaner',
      workers_needed: 3,
      shift_date: '2026-09-17',
      shift_start_time: '08:00',
      shift_end_time: '16:00',
    };
    for (const extra of [{ hourly_rate: 99 }, { currency: 'EUR' }, { requirements: 'x' }]) {
      expect(createBroadcast.args.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });

  it('is confirmed before it runs, despite being low risk', () => {
    expect(createBroadcast.confirm).toBe(true);
  });
});

describe('attendance.team_status', () => {
  it('asks the service for one day, both ends of the range', async () => {
    await teamStatus.invoke({ day: '2026-09-17' } as never, manager());
    const [query] = mockAttendanceList.mock.calls[0] as [Record<string, unknown>];
    expect({ from: query.from, to: query.to, hotel: query.hotel_id }).toEqual({
      from: '2026-09-17',
      to: '2026-09-17',
      hotel: 'h1',
    });
  });

  it('defaults to today when no day is given', async () => {
    await teamStatus.invoke({} as never, manager());
    const [query] = mockAttendanceList.mock.calls[0] as [Record<string, unknown>];
    expect(query.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query.from).toEqual(query.to);
  });

  /**
   * The whole point of the tool. A no-show has an assignment and no check-in,
   * so a summary that only listed arrivals would hide exactly the person the
   * manager is looking for.
   */
  it('counts and names who has NOT checked in, not only who has', async () => {
    mockAttendanceList.mockResolvedValue({
      total: 2,
      data: [
        { worker: { full_name: 'Anna Braun' }, check_in_at: '2026-09-17T06:02:00.000Z', check_out_at: null },
        { worker: { full_name: 'Tomasz Nowak' }, check_in_at: null, check_out_at: null },
      ],
    });

    const summary = summaryOf(teamStatus, await teamStatus.invoke({} as never, manager()));
    expect(summary).toMatch(/1 checked in, 1 not/);
    expect(summary).toMatch(/Tomasz Nowak: not checked in/);
  });

  /**
   * Reporting tools on this platform have twice shipped with a blank worker
   * column because a DTO carried only ids. AttendanceDto resolves `worker`
   * for its read paths; this pins that the summary actually uses it.
   */
  it('renders worker NAMES, never ids', async () => {
    mockAttendanceList.mockResolvedValue({
      total: 1,
      data: [
        {
          worker_id: 'ckz9v8x2h0000abcdef123456',
          worker: { full_name: 'Anna Braun' },
          check_in_at: '2026-09-17T06:02:00.000Z',
          check_out_at: '2026-09-17T14:30:00.000Z',
        },
      ],
    });

    const summary = summaryOf(teamStatus, await teamStatus.invoke({} as never, manager()));
    expect(summary).toMatch(/Anna Braun: in 06:02, out 14:30/);
    expect(summary).not.toMatch(/ckz9v8x2h/);
  });

  it('says plainly when a shift shows nothing at all', async () => {
    const summary = summaryOf(teamStatus, await teamStatus.invoke({} as never, manager()));
    expect(summary).toMatch(/No attendance recorded/i);
  });

  it('caps what it reads, and says so when there is more', async () => {
    mockAttendanceList.mockResolvedValue({
      total: 120,
      data: Array.from({ length: 40 }, (_, i) => ({
        worker: { full_name: `Worker ${i}` },
        check_in_at: '2026-09-17T06:00:00.000Z',
        check_out_at: null,
      })),
    });

    const [query] = [
      (await teamStatus.invoke({} as never, manager()), mockAttendanceList.mock.calls[0][0]),
    ] as [Record<string, unknown>];
    expect(query.per_page).toBe(40);

    mockAttendanceList.mockResolvedValue({
      total: 120,
      data: Array.from({ length: 40 }, (_, i) => ({
        worker: { full_name: `Worker ${i}` },
        check_in_at: '2026-09-17T06:00:00.000Z',
        check_out_at: null,
      })),
    });
    const summary = summaryOf(teamStatus, await teamStatus.invoke({} as never, manager()));
    expect(summary).toMatch(/first 40 of 120/);
  });
});

describe('users.find_team_member', () => {
  it('returns names and roles, and no contact details', async () => {
    const out = await findTeamMember.invoke({ name: 'Anna' } as never, manager());
    const summary = summaryOf(findTeamMember, out);

    expect(summary).toMatch(/Anna Braun \(worker\)/);
    // The DTO carries an email; passing the row through would put contact
    // details into a model's context for a question that never asked.
    expect(summary).not.toMatch(/@example\.com/);
    expect(JSON.stringify(out)).not.toMatch(/@example\.com/);
  });

  it('scopes the lookup to the actor\'s own hotel', async () => {
    await findTeamMember.invoke({} as never, manager());
    const [query] = mockListUsers.mock.calls[0] as [Record<string, unknown>];
    expect(query.hotel_id).toBe('h1');
  });

  it('passes staff_type through as the role filter', async () => {
    await findTeamMember.invoke({ staff_type: 'checker' } as never, manager());
    const [query] = mockListUsers.mock.calls[0] as [Record<string, unknown>];
    expect(query.role).toBe('checker');
  });

  it('refuses, rather than returning nothing, when nobody matches', async () => {
    mockListUsers.mockResolvedValue({ data: [], total: 0 });
    const out = await findTeamMember.invoke({ name: 'Zzz' } as never, manager());
    expect(codeOf(findTeamMember, out)).toBe('NOT_FOUND');
  });

  it('caps the page and tells the manager to narrow it', async () => {
    mockListUsers.mockResolvedValue({
      data: Array.from({ length: 25 }, (_, i) => ({ full_name: `P${i}`, role: 'WORKER' })),
      total: 610,
    });
    const summary = summaryOf(findTeamMember, await findTeamMember.invoke({} as never, manager()));
    expect(summary).toMatch(/Showing 25 of 610/);
    expect(summary).toMatch(/narrow it/i);
  });
});

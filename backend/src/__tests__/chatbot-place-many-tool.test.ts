import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPlace = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolve = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveHotel = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/assignments/service.js', () => ({
  assignmentService: { list: jest.fn(), placeOnCalendar: mockPlace },
  AssignmentService: class { list = jest.fn(); placeOnCalendar = mockPlace; },
}));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveWorkerReference: mockResolve,
  resolveHotelReference: mockResolveHotel,
  describeUnresolved: (r: any) =>
    r.status === 'AMBIGUOUS' ? `More than one worker matches "${r.query}".` : `No worker matching "${r.query}" is on your team.`,
  describeUnresolvedHotel: (r: any) =>
    r.status === 'NEEDS_NAME' ? 'Which hotel? Please name it, since you cover more than one.'
    : r.status === 'AMBIGUOUS' ? `More than one hotel matches "${r.query}".`
    : `No hotel matching "${r.query}" is in your scope.`,
}));

import { placeManyOnCalendar } from '../modules/chatbot/tools/definitions/self-service.tools.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const mgr = (): ActorContext =>
  ({ userId: 'mgr', role: 'manager', permissions: ROLE_PERMISSIONS['MANAGER'] ?? [],
     scope: { type: 'hotel', hotel_id: 'h1' } }) as unknown as ActorContext;

const resolved = (id: string, name: string) => ({ status: 'RESOLVED', workerId: id, fullName: name, hotelId: 'h1' });

const WEEK = [
  { worker_name: 'Anna', day: '2026-09-14' },
  { worker_name: 'Anna', day: '2026-09-15' },
  { worker_name: 'Tomasz', day: '2026-09-16' },
];

describe('assignments.place_many — a whole week in one instruction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveHotel.mockResolvedValue({ status: 'RESOLVED', hotelId: 'h1', name: 'Premier Inn' });
    mockResolve.mockImplementation(async (name: string) =>
      name === 'Anna' ? resolved('w1', 'Anna Schmidt') : resolved('w2', 'Tomasz Nowak'));
    mockPlace.mockResolvedValue({ assignment: { id: 'a' }, calendar_entry: { id: 'c' } });
  });

  it('places every entry and reports one summary', async () => {
    const out = await placeManyOnCalendar.invoke({ placements: WEEK } as any, mgr());
    expect(mockPlace).toHaveBeenCalledTimes(3);
    expect(placeManyOnCalendar.compress(out).summary).toBe('Scheduled 3 shifts.');
  });

  it('WRITES NOTHING if any single name fails to resolve', async () => {
    // A half-built week is harder to reason about than an empty one: the
    // manager cannot simply re-issue the instruction, because that would
    // double-book everything that did succeed.
    mockResolve.mockImplementation(async (name: string) =>
      name === 'Anna' ? resolved('w1', 'Anna Schmidt') : { status: 'NOT_FOUND', query: name });

    const out = await placeManyOnCalendar.invoke({ placements: WEEK } as any, mgr());
    expect(mockPlace).not.toHaveBeenCalled();
    expect(placeManyOnCalendar.compress(out).summary).toMatch(/Nothing was scheduled/);
    expect(placeManyOnCalendar.compress(out).summary).toMatch(/Tomasz/);
  });

  it('does not abort the rest of the week when one placement fails', async () => {
    // A worker already booked that day should not cancel a week the manager
    // has already approved.
    mockPlace
      .mockResolvedValueOnce({ assignment: {}, calendar_entry: {} })
      .mockRejectedValueOnce(new Error('already placed that day'))
      .mockResolvedValueOnce({ assignment: {}, calendar_entry: {} });

    const out = await placeManyOnCalendar.invoke({ placements: WEEK } as any, mgr());
    expect(mockPlace).toHaveBeenCalledTimes(3);
    const c = placeManyOnCalendar.compress(out);
    expect(c.summary).toBe('Scheduled 2 of 3. 1 could not be placed.');
    expect(JSON.stringify(c.data)).toContain('already placed that day');
  });

  it('reports each failure with its own reason, not one collapsed status', async () => {
    mockPlace.mockRejectedValue(new Error('not eligible at this hotel'));
    const out = await placeManyOnCalendar.invoke({ placements: WEEK } as any, mgr());
    const data = placeManyOnCalendar.compress(out).data as any;
    expect(data.failed).toHaveLength(3);
    expect(data.failed[0]).toMatchObject({ worker: 'Anna Schmidt', day: '2026-09-14' });
  });

  it('never takes an identifier, in any entry', () => {
    for (const bad of [
      { placements: [{ worker_id: 'w1', day: '2026-09-14' }] },
      { placements: [{ worker_name: 'Anna', hotel_id: 'h1', day: '2026-09-14' }] },
      { placements: [{ worker_name: 'Anna', day: 'monday' }] },
    ]) {
      expect(placeManyOnCalendar.args.safeParse(bad).success).toBe(false);
    }
  });

  it('bounds the batch, since each entry is a separate service call', () => {
    // A list long enough to exceed the turn timeout would be aborted midway
    // with some entries already written.
    const many = (n: number) => ({ placements: Array.from({ length: n }, () => ({ worker_name: 'Anna', day: '2026-09-14' })) });
    expect(placeManyOnCalendar.args.safeParse(many(30)).success).toBe(true);
    expect(placeManyOnCalendar.args.safeParse(many(31)).success).toBe(false);
    expect(placeManyOnCalendar.args.safeParse({ placements: [] }).success).toBe(false);
  });

  it('resolves the hotel ONCE for the batch, not per entry', async () => {
    // One hotel for a week. Letting each row name a different one would
    // multiply the resolution surface and make the confirmation summary far
    // harder to check at a glance.
    await placeManyOnCalendar.invoke({ placements: WEEK } as any, mgr());
    expect(mockResolveHotel).toHaveBeenCalledTimes(1);
    for (const call of mockPlace.mock.calls) expect(call[0]).toMatchObject({ hotel_id: 'h1' });
  });

  it('writes nothing and asks which hotel when the actor covers several', async () => {
    mockResolveHotel.mockResolvedValue({ status: 'NEEDS_NAME' });
    const out = await placeManyOnCalendar.invoke({ placements: WEEK } as any, mgr());
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockPlace).not.toHaveBeenCalled();
    expect(placeManyOnCalendar.compress(out).summary).toMatch(/Which hotel\?/);
  });

  it('accepts a hotel NAME for the batch, never an id', () => {
    expect(placeManyOnCalendar.args.safeParse({ hotel_name: 'Essen', placements: WEEK }).success).toBe(true);
    expect(placeManyOnCalendar.args.safeParse({ hotel_id: 'h1', placements: WEEK }).success).toBe(false);
  });

  it('is HIGH_RISK_WRITE with confirmation forced', () => {
    expect(placeManyOnCalendar.tier).toBe('HIGH_RISK_WRITE');
    expect(placeManyOnCalendar.confirm).toBe(true);
    expect(placeManyOnCalendar.permission).toBe('staffing:write');
  });

  it('reports names, never ids', async () => {
    const out = await placeManyOnCalendar.invoke({ placements: WEEK } as any, mgr());
    const json = JSON.stringify(placeManyOnCalendar.compress(out));
    expect(json).toContain('Anna Schmidt');
    expect(json).not.toContain('"w1"');
    expect(json).not.toContain('"h1"');
  });
});

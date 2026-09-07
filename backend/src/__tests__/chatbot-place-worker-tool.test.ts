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

import { placeWorkerOnCalendar } from '../modules/chatbot/tools/definitions/self-service.tools.js';
import { visibleTools } from '../modules/chatbot/orchestrator/router-l1.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorFor = (role: string): ActorContext =>
  ({ userId: `u_${role}`, role: role.toLowerCase(), permissions: ROLE_PERMISSIONS[role] ?? [],
     scope: { type: 'hotel', hotel_id: 'h1' } }) as unknown as ActorContext;

describe('assignments.place_worker — the week-planning write', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveHotel.mockResolvedValue({ status: 'RESOLVED', hotelId: 'h1', name: 'Premier Inn' });
    mockResolve.mockResolvedValue({ status: 'RESOLVED', workerId: 'w1', fullName: 'Anna Schmidt', hotelId: 'h1' });
    mockPlace.mockResolvedValue({ assignment: { id: 'a1' }, calendar_entry: { id: 'c1' } });
  });

  it('is HIGH_RISK_WRITE and cannot skip confirmation', () => {
    // It commits a worker's day and notifies them. Not something to do by
    // accident, and ADR-053 item 5 forces the flag at registration.
    expect(placeWorkerOnCalendar.tier).toBe('HIGH_RISK_WRITE');
    expect(placeWorkerOnCalendar.confirm).toBe(true);
  });

  it('accepts a NAME and refuses every identifier', () => {
    expect(placeWorkerOnCalendar.args.safeParse({ worker_name: 'Anna', day: '2026-09-10' }).success).toBe(true);
    for (const bad of [
      { worker_id: 'w1', day: '2026-09-10' },
      { worker_name: 'Anna', hotel_id: 'h1', day: '2026-09-10' },
      { worker_name: 'Anna', day: '2026-09-10', workerId: 'w1' },
    ]) {
      expect(placeWorkerOnCalendar.args.safeParse(bad).success).toBe(false);
    }
  });

  it('rejects a malformed day rather than passing it through', () => {
    for (const day of ['10/09/2026', 'tuesday', '2026-9-1', '']) {
      expect(placeWorkerOnCalendar.args.safeParse({ worker_name: 'Anna', day }).success).toBe(false);
    }
  });

  it('resolves the name and NEVER takes a hotel from arguments', async () => {
    await placeWorkerOnCalendar.invoke({ worker_name: 'Anna', day: '2026-09-10' } as any, actorFor('MANAGER'));
    // Third argument is the RESOLVED hotel id, which came from the hotel
    // resolver (itself scoped to the actor) — never from an argument.
    expect(mockResolve).toHaveBeenCalledWith('Anna', expect.anything(), 'h1');
    const [input] = mockPlace.mock.calls[0];
    // Both ids come from the resolver, which took the hotel from the actor's
    // own scope — not from anything the model said.
    expect(input).toEqual({ worker_id: 'w1', hotel_id: 'h1', day: '2026-09-10' });
  });

  it('WRITES NOTHING when the name is ambiguous', async () => {
    // Picking "the closest" would roster the wrong person against a summary
    // the manager already approved.
    mockResolve.mockResolvedValue({ status: 'AMBIGUOUS', query: 'Anna', candidates: ['Anna Schmidt', 'Anna Weber'] });
    const out = await placeWorkerOnCalendar.invoke({ worker_name: 'Anna', day: '2026-09-10' } as any, actorFor('MANAGER'));
    expect(mockPlace).not.toHaveBeenCalled();
    expect(placeWorkerOnCalendar.compress(out).summary).toMatch(/More than one worker matches/);
  });

  it('writes nothing for an unknown worker, and says so plainly', async () => {
    mockResolve.mockResolvedValue({ status: 'NOT_FOUND', query: 'Bogdan' });
    const out = await placeWorkerOnCalendar.invoke({ worker_name: 'Bogdan', day: '2026-09-10' } as any, actorFor('MANAGER'));
    expect(mockPlace).not.toHaveBeenCalled();
    expect(placeWorkerOnCalendar.compress(out).summary).toMatch(/No worker matching/);
  });

  it('ASKS WHICH HOTEL when the actor covers more than one', async () => {
    // Changed 2026-09-07: an admin or RM used to be refused outright, which
    // was a hole in the feature rather than a limit. They are now asked to
    // name a hotel, because guessing one would place a worker somewhere
    // nobody asked for.
    mockResolveHotel.mockResolvedValue({ status: 'NEEDS_NAME' });
    const out = await placeWorkerOnCalendar.invoke({ worker_name: 'Anna', day: '2026-09-10' } as any, actorFor('ADMIN'));
    expect(mockPlace).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled(); // no roster to search yet
    expect(placeWorkerOnCalendar.compress(out).summary).toMatch(/Which hotel\?/);
  });

  it('lets an admin place a worker once they name the hotel', async () => {
    mockResolveHotel.mockResolvedValue({ status: 'RESOLVED', hotelId: 'h7', name: 'Premier Inn Essen' });
    const out = await placeWorkerOnCalendar.invoke(
      { worker_name: 'Anna', day: '2026-09-10', hotel_name: 'Essen' } as any,
      actorFor('ADMIN'),
    );
    expect(mockResolveHotel).toHaveBeenCalledWith('Essen', expect.anything());
    expect(mockResolve).toHaveBeenCalledWith('Anna', expect.anything(), 'h7');
    expect(mockPlace.mock.calls[0][0]).toMatchObject({ hotel_id: 'h7' });
    // The hotel is named back, since an admin covering several needs to see
    // which one this landed on.
    expect(placeWorkerOnCalendar.compress(out).summary).toContain('Premier Inn Essen');
  });

  it('refuses a hotel it cannot identify, without touching the roster', async () => {
    mockResolveHotel.mockResolvedValue({ status: 'AMBIGUOUS', query: 'Premier', candidates: ['A', 'B'] });
    const out = await placeWorkerOnCalendar.invoke(
      { worker_name: 'Anna', day: '2026-09-10', hotel_name: 'Premier' } as any,
      actorFor('ADMIN'),
    );
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockPlace).not.toHaveBeenCalled();
    expect(placeWorkerOnCalendar.compress(out).summary).toMatch(/More than one hotel matches/);
  });

  it('accepts a hotel NAME but never a hotel id', () => {
    expect(placeWorkerOnCalendar.args.safeParse({ worker_name: 'Anna', day: '2026-09-10', hotel_name: 'Essen' }).success).toBe(true);
    expect(placeWorkerOnCalendar.args.safeParse({ worker_name: 'Anna', day: '2026-09-10', hotel_id: 'h7' }).success).toBe(false);
  });

  it('is invisible to workers and checkers', async () => {
    for (const role of ['WORKER', 'CHECKER']) {
      expect(visibleTools(actorFor(role)).map((t) => t.name)).not.toContain('assignments.place_worker');
    }
    for (const role of ['ADMIN', 'MANAGER', 'REGIONAL_MANAGER']) {
      expect(visibleTools(actorFor(role)).map((t) => t.name)).toContain('assignments.place_worker');
    }
  });

  it('confirms back the RESOLVED name, so the manager sees who was placed', () => {
    const out = placeWorkerOnCalendar.compress({ placed: { worker: 'Anna Schmidt', day: '2026-09-10' } });
    expect(out.summary).toBe('Anna Schmidt is on the calendar for 2026-09-10.');
    expect(JSON.stringify(out)).not.toContain('w1');
  });
});

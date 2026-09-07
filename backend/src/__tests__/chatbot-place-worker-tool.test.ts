import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPlace = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolve = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/assignments/service.js', () => ({
  assignmentService: { list: jest.fn(), placeOnCalendar: mockPlace },
  AssignmentService: class { list = jest.fn(); placeOnCalendar = mockPlace; },
}));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveWorkerReference: mockResolve,
  describeUnresolved: (r: any) =>
    r.status === 'AMBIGUOUS' ? `More than one worker matches "${r.query}": ${r.candidates.join(', ')}.`
    : r.status === 'NO_SCOPE' ? 'This can only be done by a manager assigned to a specific hotel.'
    : `No worker matching "${r.query}" is on your team.`,
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
    expect(mockResolve).toHaveBeenCalledWith('Anna', expect.anything());
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

  it('writes nothing for an actor with no hotel scope', async () => {
    mockResolve.mockResolvedValue({ status: 'NO_SCOPE' });
    const out = await placeWorkerOnCalendar.invoke({ worker_name: 'Anna', day: '2026-09-10' } as any, actorFor('ADMIN'));
    expect(mockPlace).not.toHaveBeenCalled();
    expect(placeWorkerOnCalendar.compress(out).summary).toMatch(/manager assigned to a specific hotel/);
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

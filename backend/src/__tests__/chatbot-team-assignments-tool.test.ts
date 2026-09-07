import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockList = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
// `AssignmentService` must be stubbed too, not just the singleton:
// calendar/service.ts constructs its own instance from this module, and a
// module mock that omits the class breaks that import chain.
jest.mock('../modules/assignments/service.js', () => ({
  assignmentService: { list: mockList },
  AssignmentService: class {
    list = mockList;
  },
}));

import { listTeamAssignments } from '../modules/chatbot/tools/definitions/self-service.tools.js';
import { visibleTools } from '../modules/chatbot/orchestrator/router-l1.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorFor = (role: string, scope: unknown = null): ActorContext =>
  ({ userId: `u_${role}`, role: role.toLowerCase(), permissions: ROLE_PERMISSIONS[role] ?? [], scope }) as unknown as ActorContext;

describe('assignments.list_for_my_team — the first manager-scoped tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue({ data: [], total: 0 });
  });

  it('is INVISIBLE to workers and checkers, who must not see the team', () => {
    // They do not hold staffing:read. A worker asking about "the team" should
    // get nothing, and the tool is not even offered to the model.
    for (const role of ['WORKER', 'CHECKER']) {
      expect(visibleTools(actorFor(role)).map((t) => t.name)).not.toContain('assignments.list_for_my_team');
    }
  });

  it('is visible to the roles that manage a team', () => {
    for (const role of ['ADMIN', 'MANAGER', 'REGIONAL_MANAGER']) {
      expect(visibleTools(actorFor(role)).map((t) => t.name)).toContain('assignments.list_for_my_team');
    }
  });

  it('accepts NO worker or hotel identifier — those are authorization inputs', () => {
    // A manager naming a person is legitimate; a model naming an ID is not.
    for (const bad of [
      { worker_id: 'w1' },
      { hotel_id: 'h1' },
      { workerId: 'w1' },
      { hotelId: 'h1' },
      { scope: 'x' },
    ]) {
      expect(listTeamAssignments.args.safeParse(bad).success).toBe(false);
    }
  });

  it('lets a manager name a person through free-text search instead', async () => {
    await listTeamAssignments.invoke({ q: 'Anna', limit: 20 } as any, actorFor('MANAGER'));
    expect(mockList.mock.calls[0][0]).toMatchObject({ q: 'Anna' });
  });

  it('passes the caller through as the actor, so the service applies ITS scoping', async () => {
    // list() narrows a scoped-manager role to its own hotel_group — added as
    // an IDOR fix after it was found returning every assignment
    // platform-wide. This tool must not reimplement that.
    const actor = actorFor('MANAGER', { type: 'hotel', id: 'h1' });
    await listTeamAssignments.invoke({ limit: 20 } as any, actor);
    const [, passedActor] = mockList.mock.calls[0];
    expect(passedActor.userId).toBe('u_MANAGER');
    expect(passedActor.role).toBe('manager');
    expect(passedActor.scope).toEqual({ type: 'hotel', id: 'h1' });
  });

  it('never sends a hotel_id of its own, even when the actor is scoped', async () => {
    await listTeamAssignments.invoke({ limit: 20 } as any, actorFor('MANAGER', { type: 'hotel', id: 'h1' }));
    expect(mockList.mock.calls[0][0]).not.toHaveProperty('hotel_id');
    expect(mockList.mock.calls[0][0]).not.toHaveProperty('worker_id');
  });

  it('bounds the search term, so one query cannot become expensive', () => {
    expect(listTeamAssignments.args.safeParse({ q: 'x'.repeat(121) }).success).toBe(false);
    expect(listTeamAssignments.args.safeParse({ q: 'x'.repeat(120) }).success).toBe(true);
    expect(listTeamAssignments.args.safeParse({ limit: 51 }).success).toBe(false);
  });

  it('only accepts statuses the underlying query supports', () => {
    expect(listTeamAssignments.args.safeParse({ status: 'CONFIRMED' }).success).toBe(true);
    expect(listTeamAssignments.args.safeParse({ status: 'PENDING' }).success).toBe(false);
  });

  it('reports people and places, not identifiers', () => {
    const out = listTeamAssignments.compress({
      data: [{ id: 'a1', worker_id: 'w1', hotel_id: 'h1', worker_name: 'Anna S', hotel_name: 'Premier Inn', status: 'CONFIRMED', confirmed_at: '2026-09-10T08:00:00.000Z' }],
    });
    const json = JSON.stringify(out);
    expect(json).toContain('Anna S');
    expect(json).toContain('Premier Inn');
    for (const id of ['a1', 'w1', 'h1']) expect(json).not.toContain(`"${id}"`);
  });

  it('handles an empty or malformed result plainly', () => {
    expect(listTeamAssignments.compress({ data: [] }).summary).toMatch(/No shifts found for your team/);
    expect(listTeamAssignments.compress(null).data).toEqual([]);
  });
});

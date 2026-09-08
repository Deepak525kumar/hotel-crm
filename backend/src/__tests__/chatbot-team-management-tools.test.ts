import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Team management: reads and writes over the people a manager already
 * manages, inside the scope they already hold.
 *
 * These are the first tools that change ANOTHER PERSON'S EMPLOYMENT STATE, so
 * the properties under test are the ones that decide who can be acted on:
 *
 *  1. The applicant is resolved from the caller's OWN review queue. Searching
 *     users generally and checking authority afterwards is the same answer in
 *     the wrong order, and the wrong order leaks who exists outside a scope.
 *  2. No employee id, hotel id or worker id is expressible as an argument.
 *  3. Every write is HIGH_RISK and confirmed.
 *  4. Ambiguity is refused, never guessed — approving the wrong person
 *     activates an account that should not exist.
 */

const mockQueue = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockApprove = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockReject = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockAssign = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockListHotels = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveHotel = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/employee-management/service.js', () => ({
  employeeManagementService: {
    getReviewQueue: mockQueue,
    approve: mockApprove,
    reject: mockReject,
    assign: mockAssign,
  },
}));
jest.mock('../modules/crm/service.js', () => ({
  crmService: { listHotels: mockListHotels },
}));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveHotelReference: mockResolveHotel,
  resolveWorkerReference: jest.fn(),
  describeUnresolved: (r: any) => `no worker: ${r.status}`,
  describeUnresolvedHotel: (r: any) =>
    r.status === 'NEEDS_NAME'
      ? 'Which hotel? Please name it, since you cover more than one.'
      : `No hotel matching "${r.query}" is in your scope.`,
}));

import {
  listReviewQueue,
  listMyHotels,
  approveApplication,
  rejectApplication,
  assignApplicantToHotel,
} from '../modules/chatbot/tools/definitions/team-management.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorFor = (role: keyof typeof ROLE_PERMISSIONS): ActorContext =>
  ({
    userId: 'm1',
    role: String(role).toLowerCase(),
    permissions: ROLE_PERMISSIONS[role] ?? [],
    scope: { type: 'hotel', hotel_id: 'h1' },
  }) as unknown as ActorContext;

const manager = () => actorFor('MANAGER');

const ANNA = {
  employee_id: 'emp_anna',
  user: { first_name: 'Anna', last_name: 'Schmidt' },
  position: 'Housekeeping',
  submitted_for_review_at: '2026-09-01T09:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQueue.mockResolvedValue([ANNA]);
  mockApprove.mockResolvedValue({});
  mockReject.mockResolvedValue({});
  mockAssign.mockResolvedValue({});
  mockListHotels.mockResolvedValue({ hotels: [{ name: 'Premier Inn', city: 'Berlin' }] });
  mockResolveHotel.mockResolvedValue({ status: 'RESOLVED', hotelId: 'h1', name: 'Premier Inn' });
});

describe('arguments and risk tiers', () => {
  it('accepts names and refuses every identifier', () => {
    expect(approveApplication.args.safeParse({ applicant_name: 'Anna' }).success).toBe(true);

    for (const bad of [
      { employee_id: 'emp_anna' },
      { applicant_name: 'Anna', employee_id: 'emp_anna' },
      { applicant_name: 'Anna', worker_id: 'w1' },
      { applicant_name: 'Anna', hotel_id: 'h1' },
    ]) {
      expect(approveApplication.args.safeParse(bad).success).toBe(false);
    }
  });

  it('makes every write a confirmed high-risk action', () => {
    // Each changes another person's employment state.
    for (const tool of [approveApplication, rejectApplication, assignApplicantToHotel]) {
      expect({ tool: tool.name, tier: tool.tier, confirm: tool.confirm }).toEqual({
        tool: tool.name,
        tier: 'HIGH_RISK_WRITE',
        confirm: true,
      });
    }
  });

  it('leaves the reads unconfirmed', () => {
    for (const tool of [listReviewQueue, listMyHotels]) {
      expect({ tool: tool.name, tier: tool.tier }).toEqual({ tool: tool.name, tier: 'READ_ONLY' });
    }
  });

  /**
   * STRICTER THAN THE API ON PURPOSE. The service takes an optional reason;
   * a rejection with none is a decision nobody can review later.
   */
  it('requires a reason to reject, which the service does not', () => {
    expect(rejectApplication.args.safeParse({ applicant_name: 'Anna' }).success).toBe(false);
    expect(
      rejectApplication.args.safeParse({ applicant_name: 'Anna', reason: 'no work permit' }).success
    ).toBe(true);
  });
});

describe('resolving the applicant', () => {
  it('resolves from the caller\'s OWN review queue, not a user search', async () => {
    await approveApplication.invoke({ applicant_name: 'Anna' } as never, manager());

    // The queue IS the scope boundary: it is the exact population this caller
    // may act on, already narrowed by the owning service.
    expect(mockQueue).toHaveBeenCalled();
    const [, employeeId] = mockApprove.mock.calls[0] as [unknown, string];
    expect(employeeId).toBe('emp_anna');
  });

  it('refuses somebody outside the caller\'s queue, writing nothing', async () => {
    mockQueue.mockResolvedValue([]);

    const out = await approveApplication.invoke({ applicant_name: 'Anna' } as never, manager());

    expect(mockApprove).not.toHaveBeenCalled();
    // Out-of-scope is indistinguishable from non-existent.
    expect(approveApplication.compress?.(out).summary).toMatch(/no one matching .* waiting/i);
  });

  it('refuses rather than guessing between two matching applicants', async () => {
    mockQueue.mockResolvedValue([
      ANNA,
      { ...ANNA, employee_id: 'emp_anna2', user: { first_name: 'Anna', last_name: 'Weber' } },
    ]);

    const out = await approveApplication.invoke({ applicant_name: 'Anna' } as never, manager());

    // Approving the wrong person activates an account that should not exist.
    expect(mockApprove).not.toHaveBeenCalled();
    expect(approveApplication.compress?.(out).summary).toMatch(/more than one applicant/i);
  });

  it('matches through German folding', async () => {
    mockQueue.mockResolvedValue([
      { ...ANNA, user: { first_name: 'Jürgen', last_name: 'Müller' } },
    ]);
    await approveApplication.invoke({ applicant_name: 'jurgen' } as never, manager());
    expect(mockApprove).toHaveBeenCalled();
  });
});

describe('the writes', () => {
  it('records the reason with a rejection', async () => {
    await rejectApplication.invoke(
      { applicant_name: 'Anna', reason: 'no work permit' } as never,
      manager()
    );
    const [, employeeId, reason] = mockReject.mock.calls[0] as [unknown, string, string];
    expect({ employeeId, reason }).toEqual({ employeeId: 'emp_anna', reason: 'no work permit' });
  });

  it('resolves the hotel before the person, and by name', async () => {
    await assignApplicantToHotel.invoke(
      { applicant_name: 'Anna', hotel_name: 'Premier Inn' } as never,
      manager()
    );

    const [, employeeId, payload] = mockAssign.mock.calls[0] as [
      unknown,
      string,
      { primary_hotel_id: string },
    ];
    expect(employeeId).toBe('emp_anna');
    // The id came from the resolver, which scopes its own candidates.
    expect(payload.primary_hotel_id).toBe('h1');
  });

  it('writes nothing when the hotel is outside the caller\'s scope', async () => {
    mockResolveHotel.mockResolvedValue({ status: 'NOT_FOUND', query: 'Ritz' });

    const out = await assignApplicantToHotel.invoke(
      { applicant_name: 'Anna', hotel_name: 'Ritz' } as never,
      manager()
    );

    expect(mockAssign).not.toHaveBeenCalled();
    expect(mockQueue).not.toHaveBeenCalled(); // hotel first, so no queue read either
    expect(assignApplicantToHotel.compress?.(out).summary).toMatch(/no hotel matching/i);
  });

  it('names the person in the confirmation, not an id', async () => {
    const out = await approveApplication.invoke({ applicant_name: 'Anna' } as never, manager());
    const summary = approveApplication.compress?.(out).summary ?? '';
    expect(summary).toMatch(/Anna Schmidt is approved/i);
    expect(JSON.stringify(approveApplication.compress?.(out))).not.toContain('emp_anna');
  });
});

describe('the reads', () => {
  it('reports an empty queue as itself', async () => {
    mockQueue.mockResolvedValue([]);
    const out = await listReviewQueue.invoke({} as never, manager());
    expect(listReviewQueue.compress?.(out).summary).toMatch(/nobody is waiting/i);
  });

  it('leaks no employee id into what the model sees', async () => {
    const out = await listReviewQueue.invoke({} as never, manager());
    expect(JSON.stringify(listReviewQueue.compress?.(out))).not.toContain('emp_anna');
  });

  it('passes the caller\'s own role and scope to listHotels', async () => {
    await listMyHotels.invoke({} as never, manager());
    const [, role, userId] = mockListHotels.mock.calls[0] as [unknown, string, string];
    expect({ role, userId }).toEqual({ role: 'manager', userId: 'm1' });
  });
});

/**
 * The population admitted must match the routes these tools wrap, checked
 * against the REAL permission sets.
 */
describe('who may manage a team', () => {
  it.each([['ADMIN'], ['MANAGER'], ['REGIONAL_MANAGER']])(
    'admits %s to the writes, matching requirePermission on the route',
    (role) => {
      const gate = approveApplication.permission!;
      expect(actorHasPermission(actorFor(role as keyof typeof ROLE_PERMISSIONS), gate)).toBe(true);
    }
  );

  it.each([['WORKER'], ['CHECKER']])('denies %s every write', (role) => {
    const a = actorFor(role as keyof typeof ROLE_PERMISSIONS);
    for (const tool of [approveApplication, rejectApplication, assignApplicantToHotel]) {
      expect({ tool: tool.name, usable: actorHasPermission(a, tool.permission!) }).toEqual({
        tool: tool.name,
        usable: false,
      });
    }
  });

  /**
   * REGRESSION. The review queue first declared `employees:read`, which WORKER
   * and CHECKER also hold -- so a tool listing other people's employment
   * records would have appeared in a worker's manifest. The service refuses
   * them, so nothing leaked; but a capability every role can SEE is not least
   * privilege, and the design-rule suite caught it rather than a reviewer.
   */
  it.each([['WORKER'], ['CHECKER']])('keeps %s out of the review queue entirely', (role) => {
    expect(
      actorHasPermission(actorFor(role as keyof typeof ROLE_PERMISSIONS), listReviewQueue.permission!)
    ).toBe(false);
  });

  it.each([['ADMIN'], ['MANAGER'], ['REGIONAL_MANAGER']])(
    'admits %s to the review queue, matching requireRole on the route',
    (role) => {
      expect(
        actorHasPermission(
          actorFor(role as keyof typeof ROLE_PERMISSIONS),
          listReviewQueue.permission!
        )
      ).toBe(true);
    }
  );
});

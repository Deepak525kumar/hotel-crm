import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockEligible = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockFindMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../lib/roster-scope.js', () => ({ listEligibleWorkerIds: mockEligible }));
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockListHotels = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({ user: { findMany: mockFindMany }, hotel: { findUnique: mockHotelFindUnique } }),
}));
jest.mock('../modules/crm/service.js', () => ({ crmService: { listHotels: mockListHotels } }));

import {
  resolveWorkerReference,
  describeUnresolved,
  resolveHotelReference,
  describeUnresolvedHotel,
  type WorkerReferenceResult,
  type HotelReferenceResult,
} from '../modules/chatbot/tools/worker-reference.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const manager = (hotelId = 'h1'): ActorContext =>
  ({ userId: 'mgr', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: hotelId } }) as unknown as ActorContext;

// `role` is selected by the resolver (2026-09-10) so an ambiguous answer can
// tell a worker and a checker apart. Default WORKER; pass CHECKER to exercise
// the role this resolver used to be blind to.
const worker = (id: string, first: string, last: string, role: 'WORKER' | 'CHECKER' = 'WORKER') => ({
  id,
  first_name: first,
  last_name: last,
  role,
});

describe('resolveWorkerReference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEligible.mockResolvedValue(['w1', 'w2', 'w3']);
    mockFindMany.mockResolvedValue([
      worker('w1', 'Anna', 'Schmidt'),
      worker('w2', 'Tomasz', 'Nowak'),
      worker('w3', 'Ayşe', 'Ünal'),
    ]);
  });

  it('SCOPES BEFORE MATCHING — candidates come from the actor’s own hotel', async () => {
    // The ordering is the security property. Searching platform-wide and
    // filtering afterwards would make this a probe oracle: a manager could
    // learn who exists elsewhere from the shape of the responses.
    await resolveWorkerReference('Anna', manager('h1'));
    // WORKER **and CHECKER** since 2026-09-10: a checker works a shift exactly
    // as a worker does, and searching workers only meant a manager asking to
    // place one was told they were "not on your team". Both are named rather
    // than omitting the filter, which would also sweep in managers and admins.
    expect(mockEligible).toHaveBeenCalledWith('h1', ['WORKER', 'CHECKER']);
    // And the user lookup is constrained to those ids, never open.
    expect(mockFindMany.mock.calls[0][0].where.id).toEqual({ in: ['w1', 'w2', 'w3'] });
  });

  it('resolves a unique first-name match', async () => {
    const r = await resolveWorkerReference('anna', manager());
    expect(r).toEqual({ status: 'RESOLVED', workerId: 'w1', fullName: 'Anna Schmidt', hotelId: 'h1' });
  });

  it('resolves on surname too, not just a prefix', async () => {
    // Managers say "Schmidt" as readily as "Anna"; a prefix match would fail
    // every surname query.
    expect((await resolveWorkerReference('schmidt', manager())).status).toBe('RESOLVED');
  });

  it('matches across diacritics, since German and Turkish names carry them', async () => {
    const r = await resolveWorkerReference('ayse unal', manager());
    expect(r).toMatchObject({ status: 'RESOLVED', fullName: 'Ayşe Ünal' });
  });

  it('REFUSES on ambiguity rather than guessing', async () => {
    // Picking "the closest" would silently roster the wrong person, and the
    // manager would confirm a summary naming someone they never chose.
    mockFindMany.mockResolvedValue([worker('w1', 'Anna', 'Schmidt'), worker('w4', 'Anna', 'Weber')]);
    const r = await resolveWorkerReference('anna', manager());
    expect(r.status).toBe('AMBIGUOUS');
    // The ROLE is shown now that both are searched: without it "Anna Braun"
    // and "Anna Braun" are the same string, and telling two people apart is
    // the entire purpose of this message.
    expect(r).toMatchObject({ candidates: ['Anna Schmidt (worker)', 'Anna Weber (worker)'] });
  });

  it('returns NOT_FOUND for someone outside the scope, indistinguishably from nobody', async () => {
    // A worker at another hotel must look exactly like a worker who does not
    // exist. Anything else is an oracle.
    const r = await resolveWorkerReference('Bogdan', manager());
    expect(r).toEqual({ status: 'NOT_FOUND', query: 'Bogdan' });
  });

  it('refuses an actor with no hotel scope instead of guessing one', async () => {
    // An admin or RM has no single hotel to resolve against.
    const admin = { userId: 'a', role: 'admin', permissions: [], scope: null } as unknown as ActorContext;
    expect((await resolveWorkerReference('Anna', admin)).status).toBe('NO_SCOPE');
    const rm = { userId: 'r', role: 'regional_manager', permissions: [], scope: { type: 'hotel_group', hotel_group_id: 'g1' } } as unknown as ActorContext;
    expect((await resolveWorkerReference('Anna', rm)).status).toBe('NO_SCOPE');
    expect(mockEligible).not.toHaveBeenCalled();
  });

  it('excludes deleted and deactivated people from candidates', async () => {
    await resolveWorkerReference('Anna', manager());
    expect(mockFindMany.mock.calls[0][0].where).toMatchObject({ deleted_at: null, is_active: true });
  });

  it('handles an empty roster and an empty query without throwing', async () => {
    mockEligible.mockResolvedValue([]);
    expect((await resolveWorkerReference('Anna', manager())).status).toBe('NOT_FOUND');
    expect((await resolveWorkerReference('   ', manager())).status).toBe('NOT_FOUND');
  });
});

describe('describeUnresolved', () => {
  it('names the alternatives on ambiguity, so the manager can choose', () => {
    const msg = describeUnresolved({ status: 'AMBIGUOUS', query: 'Anna', candidates: ['Anna Schmidt', 'Anna Weber'] });
    expect(msg).toContain('Anna Schmidt');
    expect(msg).toContain('Anna Weber');
  });

  it('never leaks an id in any message', () => {
    const cases: WorkerReferenceResult[] = [
      { status: 'NOT_FOUND', query: 'x' },
      { status: 'AMBIGUOUS', query: 'x', candidates: ['A B'] },
      { status: 'NO_SCOPE' },
    ];
    for (const r of cases) {
      expect(describeUnresolved(r)).not.toMatch(/\bw\d\b|cm[a-z0-9]{10,}/);
    }
  });
});


describe('resolveHotelReference', () => {
  const groupRm = { userId: 'rm', role: 'regional_manager', permissions: [], scope: { type: 'hotel_group', hotel_group_id: 'g1' } } as unknown as ActorContext;
  const admin = { userId: 'a', role: 'admin', permissions: [], scope: null } as unknown as ActorContext;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHotelFindUnique.mockResolvedValue({ id: 'h1', name: 'Premier Inn Essen' });
    mockListHotels.mockResolvedValue({ hotels: [{ id: 'h7', name: 'Premier Inn Essen' }], pagination: {} });
  });

  it('uses a hotel-scoped manager’s own hotel, with no name needed', async () => {
    const r = await resolveHotelReference(undefined, manager('h1'));
    expect(r).toEqual({ status: 'RESOLVED', hotelId: 'h1', name: 'Premier Inn Essen' });
    // No search: they have exactly one hotel.
    expect(mockListHotels).not.toHaveBeenCalled();
  });

  it('REFUSES when a scoped manager names a hotel that is not theirs', async () => {
    // Silently substituting their own hotel would place a worker somewhere
    // they did not ask for — precisely what the confirmation summary exists
    // to make visible.
    const r = await resolveHotelReference('Hilton', manager('h1'));
    expect(r.status).toBe('NOT_FOUND');
  });

  it('accepts a scoped manager naming their own hotel', async () => {
    expect((await resolveHotelReference('Essen', manager('h1'))).status).toBe('RESOLVED');
  });

  it('asks an unscoped actor to name a hotel rather than guessing', async () => {
    for (const actor of [admin, groupRm]) {
      const r = await resolveHotelReference(undefined, actor);
      expect(r.status).toBe('NEEDS_NAME');
    }
  });

  /**
   * It ASKS WITH THE OPTIONS IN THE QUESTION (2026-09-10).
   *
   * The question used to be "Which hotel? Please name it, since you cover
   * more than one" -- which withholds the one thing needed to answer it. In
   * production a manager was asked it twice and replied "what are the
   * options.", which is the only sensible response.
   *
   * The listing is the caller's OWN, unfiltered by any search term: this is
   * "here are yours", not a guess at what they meant. Nothing is resolved
   * from it -- the status is still NEEDS_NAME.
   */
  it('lists the caller\'s own hotels in the question, without searching for one', async () => {
    mockListHotels.mockResolvedValue({
      hotels: [{ id: 'h1', name: 'Hotel Adler' }, { id: 'h2', name: 'Premier Inn Essen' }],
      pagination: {},
    });

    const r = await resolveHotelReference(undefined, admin);

    expect(r.status).toBe('NEEDS_NAME');
    expect(r).toMatchObject({ choices: ['Hotel Adler', 'Premier Inn Essen'] });
    // No search term: it is not guessing which one, only naming both.
    expect(mockListHotels.mock.calls[0][0]).not.toHaveProperty('search');
    expect(describeUnresolvedHotel(r)).toMatch(/Hotel Adler.*Premier Inn Essen/);
  });

  /**
   * Past a dozen the list stops being an answer and becomes a wall, so it is
   * dropped and the plain question comes back.
   */
  it('drops the list when there are too many hotels to name', async () => {
    mockListHotels.mockResolvedValue({
      hotels: Array.from({ length: 13 }, (_, i) => ({ id: `h${i}`, name: `Hotel ${i}` })),
      pagination: {},
    });

    const r = await resolveHotelReference(undefined, admin);
    expect(r).toMatchObject({ status: 'NEEDS_NAME', choices: [] });
    expect(describeUnresolvedHotel(r)).toMatch(/Which hotel\?/);
  });

  it('searches through the ACTOR-SCOPED listing, never an open query', async () => {
    // listHotels applies its own scope narrowing for managers and RMs — an
    // IDOR fix of its own. Passing the actor is what bounds the candidates.
    await resolveHotelReference('Essen', groupRm);
    const [query, role, userId, scope] = mockListHotels.mock.calls[0];
    expect(query).toMatchObject({ search: 'Essen' });
    expect(role).toBe('regional_manager');
    expect(userId).toBe('rm');
    expect(scope).toEqual({ type: 'hotel_group', hotel_group_id: 'g1' });
  });

  it('refuses on ambiguity rather than picking one', async () => {
    mockListHotels.mockResolvedValue({ hotels: [{ id: 'h1', name: 'Premier Inn A' }, { id: 'h2', name: 'Premier Inn B' }], pagination: {} });
    const r = await resolveHotelReference('Premier', admin);
    expect(r).toMatchObject({ status: 'AMBIGUOUS', candidates: ['Premier Inn A', 'Premier Inn B'] });
  });

  it('returns NOT_FOUND for a hotel outside scope, indistinguishably from none', async () => {
    mockListHotels.mockResolvedValue({ hotels: [], pagination: {} });
    expect((await resolveHotelReference('Nowhere', groupRm)).status).toBe('NOT_FOUND');
  });

  it('never leaks an id in any message', () => {
    const cases: HotelReferenceResult[] = [
      { status: 'NEEDS_NAME', choices: [] },
      { status: 'NEEDS_NAME', choices: ['Hotel Adler', 'Premier Inn Essen'] },
      { status: 'NOT_FOUND', query: 'x' },
      { status: 'AMBIGUOUS', query: 'x', candidates: ['A'] },
    ];
    for (const r of cases) {
      expect(describeUnresolvedHotel(r)).not.toMatch(/\bh\d\b|cm[a-z0-9]{10,}/);
    }
  });
});

describe('resolveWorkerReference with an explicit hotel', () => {
  it('searches the GIVEN hotel roster, letting an unscoped actor use the tool', async () => {
    jest.clearAllMocks();
    mockEligible.mockResolvedValue(['w1']);
    mockFindMany.mockResolvedValue([worker('w1', 'Anna', 'Schmidt')]);
    const admin = { userId: 'a', role: 'admin', permissions: [], scope: null } as unknown as ActorContext;

    const r = await resolveWorkerReference('Anna', admin, 'h7');
    expect(mockEligible).toHaveBeenCalledWith('h7', ['WORKER', 'CHECKER']);
    expect(r).toMatchObject({ status: 'RESOLVED', hotelId: 'h7' });
  });
});

/**
 * THE CHECKER, AND THE EXACT NAME.
 *
 * Both reported from production on 2026-09-10, in the same conversation.
 */
describe('resolving people the resolver used to be unable to find', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEligible.mockResolvedValue(['w1', 'c1']);
  });

  /**
   *     > place checker named new checker on a shift in hotel 1 today
   *     No worker matching "new checker" is on your team.
   *     > not worker i am saying he's a checker
   *     No worker matching "new checker" is on your team.
   *
   * They were on the team. The assistant could not see them, and repeated a
   * flat contradiction when corrected.
   */
  it('finds a CHECKER by name, not only a worker', async () => {
    mockFindMany.mockResolvedValue([worker('c1', 'New', 'Checker', 'CHECKER')]);

    const r = await resolveWorkerReference('new checker', manager('h1'));
    expect(r).toMatchObject({ status: 'RESOLVED', workerId: 'c1', fullName: 'New Checker' });
  });

  /**
   * Managers and admins hold employment records too, and a manager is not
   * someone you put on a cleaning shift -- so the filter names both staffing
   * roles rather than being omitted.
   */
  it('asks for exactly WORKER and CHECKER, never an unfiltered roster', async () => {
    mockFindMany.mockResolvedValue([worker('w1', 'Anna', 'Braun')]);
    await resolveWorkerReference('Anna', manager('h1'));

    const [, roles] = mockEligible.mock.calls[0];
    expect(roles).toEqual(['WORKER', 'CHECKER']);
  });

  /**
   *     > is worker 1 available to work in hotel 1 today?
   *     More than one worker matches "worker 1": worker 1, worker 10.
   *     Please use a fuller name.
   *
   * There is no fuller name -- "worker 1" IS the full name. The manager was
   * asked for something they could not give, and resorted to quoting it.
   */
  it('resolves an EXACT name even when another name contains it', async () => {
    mockEligible.mockResolvedValue(['w1', 'w10']);
    mockFindMany.mockResolvedValue([
      worker('w1', 'worker', '1'),
      worker('w10', 'worker', '10'),
    ]);

    const r = await resolveWorkerReference('worker 1', manager('h1'));
    expect(r).toMatchObject({ status: 'RESOLVED', workerId: 'w1', fullName: 'worker 1' });
  });

  /** A genuinely partial name is still ambiguous -- that part was correct. */
  it('still refuses when the query matches several and none exactly', async () => {
    mockEligible.mockResolvedValue(['w1', 'w10']);
    mockFindMany.mockResolvedValue([
      worker('w1', 'worker', '1'),
      worker('w10', 'worker', '10'),
    ]);

    const r = await resolveWorkerReference('worker', manager('h1'));
    expect(r.status).toBe('AMBIGUOUS');
  });

  /** Two people with the SAME name are still ambiguous, and told apart by role. */
  it('does not let an exact match hide a real duplicate', async () => {
    mockEligible.mockResolvedValue(['w1', 'c1']);
    mockFindMany.mockResolvedValue([
      worker('w1', 'Anna', 'Braun'),
      worker('c1', 'Anna', 'Braun', 'CHECKER'),
    ]);

    const r = await resolveWorkerReference('Anna Braun', manager('h1'));
    expect(r).toMatchObject({
      status: 'AMBIGUOUS',
      candidates: ['Anna Braun (checker)', 'Anna Braun (worker)'],
    });
  });
});

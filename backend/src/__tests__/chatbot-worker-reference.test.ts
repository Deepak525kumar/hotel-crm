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

const worker = (id: string, first: string, last: string) => ({ id, first_name: first, last_name: last });

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
    expect(mockEligible).toHaveBeenCalledWith('h1', 'WORKER');
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
    expect(r).toMatchObject({ candidates: ['Anna Schmidt', 'Anna Weber'] });
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
    expect(mockListHotels).not.toHaveBeenCalled();
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
      { status: 'NEEDS_NAME' },
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
    expect(mockEligible).toHaveBeenCalledWith('h7', 'WORKER');
    expect(r).toMatchObject({ status: 'RESOLVED', hotelId: 'h7' });
  });
});

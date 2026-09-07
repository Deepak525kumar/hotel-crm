import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockEligible = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockFindMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../lib/roster-scope.js', () => ({ listEligibleWorkerIds: mockEligible }));
jest.mock('../lib/db.js', () => ({ getPrisma: () => ({ user: { findMany: mockFindMany } }) }));

import {
  resolveWorkerReference,
  describeUnresolved,
  type WorkerReferenceResult,
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

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Daily Shift Summary authorization scope (ADR-051 revival).
 *
 * Coverage gap closed 2026-08-12: the shift-summary routes
 * (`GET`/`PUT /calendar/hotels/:hotel_id/shift-summaries`) had NO automated
 * coverage for ANY role, so the `regional_manager` path was shipped
 * code-reviewed only. The RM branch is the interesting one: unlike a hotel
 * manager (`{type:'hotel'}`, one fixed hotel id compared directly), an RM
 * holds a `{type:'hotel_group'}` claim, so authorization requires a DB read of
 * the target hotel's `hotel_group_id` — a step that simply does not exist for
 * the manager branch this feature's review reasoned by analogy from.
 *
 * These tests exercise `resolveHotelAccess` — the function the routes' single
 * `checkHotelAccess()` gate delegates to — rather than the express layer,
 * matching the existing calendar scope suites
 * (calendar-list-absences-scope.test.ts et al) and rbac.test.ts. The service
 * layer deliberately does NOT re-check scope (it filters on hotel_id only), so
 * this middleware decision is the ONLY authorization boundary for the feature;
 * that is precisely why it is worth pinning.
 */

const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

const mockPrisma = {
  hotel: { findUnique: mockHotelFindUnique },
};

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));
jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

import { resolveHotelAccess } from '../middleware/permissions.js';

const IN_GROUP_HOTEL = 'hotel-in-group';
const OUT_OF_GROUP_HOTEL = 'hotel-other-group';
const RM_GROUP = 'group-rm';
const OTHER_GROUP = 'group-other';

describe('Daily Shift Summary hotel-scope authorization', () => {
  beforeEach(() => {
    mockHotelFindUnique.mockReset();
    mockHotelFindUnique.mockImplementation(async (args: any) => {
      if (args?.where?.id === IN_GROUP_HOTEL) return { hotel_group_id: RM_GROUP };
      if (args?.where?.id === OUT_OF_GROUP_HOTEL) return { hotel_group_id: OTHER_GROUP };
      return null;
    });
  });

  describe('regional_manager (hotel_group scope)', () => {
    const rmScope = { type: 'hotel_group' as const, hotel_group_id: RM_GROUP };

    it('allows a hotel inside the RM group, resolving the group via the hotel row', async () => {
      const decision = await resolveHotelAccess('regional_manager', 'rm-1', IN_GROUP_HOTEL, rmScope);

      expect(decision.allowed).toBe(true);
      // Not a bypass: an RM is scope-checked, unlike admin/checker.
      if (decision.allowed) expect(decision.viaBypass).toBe(false);
      expect(mockHotelFindUnique).toHaveBeenCalledWith({
        where: { id: IN_GROUP_HOTEL },
        select: { hotel_group_id: true },
      });
    });

    it('denies a hotel belonging to a different group', async () => {
      const decision = await resolveHotelAccess('regional_manager', 'rm-1', OUT_OF_GROUP_HOTEL, rmScope);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('out_of_scope');
    });

    it('denies a hotel that does not exist rather than defaulting to allow', async () => {
      const decision = await resolveHotelAccess('regional_manager', 'rm-1', 'no-such-hotel', rmScope);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('out_of_scope');
    });

    /**
     * The pre-assignment RM case. An RM whose group assignment has not been
     * written yet has NO scope claim, and `isHotelInScope` deny-by-defaults on
     * `!scope`. Pinned because two separate visibility guards in this codebase
     * have broken by assuming a scope always exists for a manager-grade role.
     */
    it('denies an RM with no scope claim (unassigned) instead of throwing', async () => {
      const decision = await resolveHotelAccess('regional_manager', 'rm-unassigned', IN_GROUP_HOTEL, null);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('out_of_scope');
    });

    it('denies when no hotel_id is supplied at all', async () => {
      const decision = await resolveHotelAccess('regional_manager', 'rm-1', undefined, rmScope);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('missing_hotel_id');
      expect(mockHotelFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('hotel manager (hotel scope) — the already-verified branch, pinned alongside', () => {
    it('allows exactly its own hotel with no DB lookup', async () => {
      const decision = await resolveHotelAccess('manager', 'mgr-1', IN_GROUP_HOTEL, {
        type: 'hotel',
        hotel_id: IN_GROUP_HOTEL,
      });

      expect(decision.allowed).toBe(true);
      // A `{type:'hotel'}` claim is compared directly — no hotel row is read.
      expect(mockHotelFindUnique).not.toHaveBeenCalled();
    });

    it('denies a different hotel, even one in the same group', async () => {
      const decision = await resolveHotelAccess('manager', 'mgr-1', OUT_OF_GROUP_HOTEL, {
        type: 'hotel',
        hotel_id: IN_GROUP_HOTEL,
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('out_of_scope');
    });
  });

  describe('admin', () => {
    it('bypasses the hotel membership check entirely', async () => {
      const decision = await resolveHotelAccess('admin', 'admin-1', OUT_OF_GROUP_HOTEL, {
        type: 'global',
      });

      expect(decision.allowed).toBe(true);
      if (decision.allowed) expect(decision.viaBypass).toBe(true);
    });
  });
});

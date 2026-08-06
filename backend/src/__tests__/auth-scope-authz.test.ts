import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Scope-based authorization unit test for Epic 5 PR 5.5 (ADR-024).
 *
 * Cites OQ-AUTH-06 / SIR-AUTH-003: the `manager` role must be constrained to
 * the hotels in its PR 5.4 JWT `scope` claim instead of bypassing hotel access.
 * The cutover flag (FEATURE_SCOPE_AUTHZ) was retired in ADR-030 PR-5 (M-4):
 * scope-binding is now unconditional, not a toggle.
 *
 * Exercises resolveHotelAccess() directly. Reintroducing the old manager
 * bypass makes the out-of-scope / null-scope deny cases below fail — this
 * suite is the removal-detector for that change.
 */

const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
// isWorkerEligibleForHotel() (roster-scope.ts) now checks the hotel
// blocklist (REQ-EMP-005 / RULE-EMP-07 rework, 2026-08-06) -- default to
// "not blocked" so this scope-authz suite doesn't need to know about it.
const mockBlocklistEntryFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
    hotel: { findUnique: mockHotelFindUnique },
    employeeBlocklistEntry: { findUnique: mockBlocklistEntryFindUnique },
  }),
}));

// permissions.ts imports isGD02MatrixEnabled (ADR-030 PR-5) — mocked so this
// suite never transitively loads the real env.ts under jest.
jest.mock('../config/feature-flags.js', () => ({
  isGD02MatrixEnabled: () => false,
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

import { resolveHotelAccess } from '../middleware/permissions.js';

describe('resolveHotelAccess scope-authz (OQ-AUTH-06 / SIR-AUTH-003)', () => {
  beforeEach(() => {
    mockEmploymentRecordFindUnique.mockReset();
    mockHotelFindUnique.mockReset();
    mockBlocklistEntryFindUnique.mockReset().mockResolvedValue(null);
  });

  describe('manager', () => {
    it('allows when hotel scope matches the target hotel', async () => {
      const d = await resolveHotelAccess('manager', 'u1', 'h1', { type: 'hotel', hotel_id: 'h1' });
      expect(d).toEqual({ allowed: true, viaBypass: false });
    });

    it('denies (out_of_scope) when hotel scope does not match', async () => {
      const d = await resolveHotelAccess('manager', 'u1', 'h1', { type: 'hotel', hotel_id: 'h_other' });
      expect(d).toEqual({ allowed: false, reason: 'out_of_scope' });
    });

    it('allows a hotel_group scope when the target hotel is in the group', async () => {
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const d = await resolveHotelAccess('manager', 'u1', 'h1', { type: 'hotel_group', hotel_group_id: 'g1' });
      expect(d).toEqual({ allowed: true, viaBypass: false });
      expect(mockHotelFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'h1' }, select: { hotel_group_id: true } })
      );
    });

    it('denies a hotel_group scope when the target hotel is in another group', async () => {
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g_other' });
      const d = await resolveHotelAccess('manager', 'u1', 'h1', { type: 'hotel_group', hotel_group_id: 'g1' });
      expect(d).toEqual({ allowed: false, reason: 'out_of_scope' });
    });

    it('denies a hotel_group scope when the target hotel does not exist', async () => {
      mockHotelFindUnique.mockResolvedValue(null);
      const d = await resolveHotelAccess('manager', 'u1', 'h1', { type: 'hotel_group', hotel_group_id: 'g1' });
      expect(d).toEqual({ allowed: false, reason: 'out_of_scope' });
    });

    it('allows a global scope for any hotel', async () => {
      const d = await resolveHotelAccess('manager', 'u1', 'h1', { type: 'global' });
      expect(d).toEqual({ allowed: true, viaBypass: false });
    });

    it('denies a null scope', async () => {
      const d = await resolveHotelAccess('manager', 'u1', 'h1', null);
      expect(d).toEqual({ allowed: false, reason: 'out_of_scope' });
    });

    it('denies with missing_hotel_id when no hotel is provided', async () => {
      const d = await resolveHotelAccess('manager', 'u1', undefined, { type: 'global' });
      expect(d).toEqual({ allowed: false, reason: 'missing_hotel_id' });
    });
  });

  describe('other roles (unchanged)', () => {
    it('allows admin via bypass', async () => {
      const d = await resolveHotelAccess('admin', 'u1', 'h1', null);
      expect(d).toEqual({ allowed: true, viaBypass: true });
    });

    it('allows checker via bypass (cross-hotel preserved)', async () => {
      const d = await resolveHotelAccess('checker', 'u1', 'h1', null);
      expect(d).toEqual({ allowed: true, viaBypass: true });
    });

    it('allows a worker with an ACTIVE employment record in the hotel group', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const d = await resolveHotelAccess('worker', 'w1', 'h1', null);
      expect(d).toEqual({ allowed: true, viaBypass: false });
    });

    it('denies a worker without an employment record', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue(null);
      const d = await resolveHotelAccess('worker', 'w1', 'h1', null);
      expect(d).toEqual({ allowed: false, reason: 'no_membership' });
    });
  });
});

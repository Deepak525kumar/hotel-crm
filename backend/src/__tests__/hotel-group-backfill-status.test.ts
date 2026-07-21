import { describe, it, expect, jest } from '@jest/globals';

/**
 * Regression test for Epic 5 PR 5.3's backfill-status tool
 * (scripts/hotel-group-backfill-status.ts). Locks the query shape: it must
 * find every Hotel with a null hotel_group_id, including soft-deleted rows
 * (a table-wide NOT NULL constraint, if ever applied, would apply regardless
 * of deleted_at) — it must not silently exclude them via an is_active/
 * deleted_at filter.
 */

import { findUngroupedHotels } from '../scripts/hotel-group-backfill-status.js';

describe('findUngroupedHotels', () => {
  it('queries only by hotel_group_id: null, with no deleted_at/is_active filter', async () => {
    const findMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
    findMany.mockResolvedValue([
      { id: 'h1', name: 'Ungrouped Hotel', deleted_at: null },
      { id: 'h2', name: 'Soft-deleted Ungrouped Hotel', deleted_at: new Date() },
    ]);
    const prisma = { hotel: { findMany } } as any;

    const result = await findUngroupedHotels(prisma);

    expect(result).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hotel_group_id: null } })
    );
  });

  it('returns an empty list when every hotel has a group', async () => {
    const findMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
    findMany.mockResolvedValue([]);
    const prisma = { hotel: { findMany } } as any;

    const result = await findUngroupedHotels(prisma);

    expect(result).toEqual([]);
  });
});

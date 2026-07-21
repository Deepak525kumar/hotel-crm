/**
 * Epic 5 PR 5.3 — Hotel -> HotelGroup backfill status query.
 *
 * `Hotel.hotel_group_id` stays nullable in this PR (see the PR body for the
 * deferral rationale: flipping it to NOT NULL now would force every hotel
 * creation to pre-select a group, a workflow change no authority explicitly
 * requires yet, and creates a bootstrapping problem on a fresh deployment
 * with zero HotelGroup rows). This module backs the operational tool for
 * tracking backfill progress via `PATCH /api/v1/crm/hotels/:hotel_id
 * {"hotel_group_id": "..."}` (introduced in this same PR) and for proving —
 * whenever a future PR proposes the NOT NULL flip — that every Hotel row
 * (including soft-deleted ones; a table-wide NOT NULL constraint applies
 * regardless of `deleted_at`) already has a group.
 *
 * It does NOT invent an assignment for ungrouped hotels: which HotelGroup a
 * given hotel belongs to is an operational/business decision, made through
 * the API by an admin, not something this module may infer.
 *
 * CLI entrypoint: run-hotel-group-backfill-status.ts (kept separate so this
 * module stays free of import.meta/process-exit CLI concerns and is plainly
 * unit-testable).
 */
import { PrismaClient } from '@prisma/client';

export interface UngroupedHotel {
  id: string;
  name: string;
  deleted_at: Date | null;
}

export async function findUngroupedHotels(
  prisma: Pick<PrismaClient, 'hotel'>
): Promise<UngroupedHotel[]> {
  return prisma.hotel.findMany({
    where: { hotel_group_id: null },
    select: { id: true, name: true, deleted_at: true },
    orderBy: { created_at: 'asc' },
  });
}

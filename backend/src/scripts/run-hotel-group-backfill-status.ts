#!/usr/bin/env tsx
/**
 * CLI entrypoint for the Epic 5 PR 5.3 backfill-status check. See
 * hotel-group-backfill-status.ts for the rationale and query logic.
 *
 * Usage: DATABASE_URL=... npm run hotel-group:backfill-status
 * Exit 0 = every hotel has a hotel_group_id (backfill complete).
 * Exit 1 = ungrouped hotels remain (backfill incomplete).
 */
import { PrismaClient } from '@prisma/client';
import { findUngroupedHotels } from './hotel-group-backfill-status.js';

async function main() {
  const prisma = new PrismaClient();
  try {
    const ungrouped = await findUngroupedHotels(prisma);

    if (ungrouped.length > 0) {
      console.error(`[hotel-group-backfill-status] INCOMPLETE: ${ungrouped.length} hotel(s) have no hotel_group_id.`);
      console.error('Assign each via PATCH /api/v1/crm/hotels/:hotel_id {"hotel_group_id": "..."}.');
      for (const h of ungrouped) {
        console.error(`  - ${h.id} (${h.name})${h.deleted_at ? ' [soft-deleted]' : ''}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log('[hotel-group-backfill-status] COMPLETE: every Hotel row has a hotel_group_id.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[hotel-group-backfill-status] ERROR:', err);
  process.exitCode = 1;
});

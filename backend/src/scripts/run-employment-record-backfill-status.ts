#!/usr/bin/env tsx
/**
 * CLI entrypoint for the Epic 5 PR 5.8 HotelWorker -> EmploymentRecord
 * backfill-status report. See employment-record-backfill-status.ts for the
 * rationale and query logic.
 *
 * Read-only: writes nothing, has no side effects. This does not resolve or
 * act on the `HotelWorker` table's fate — it only gives a human real data
 * for that future decision.
 *
 * Usage: DATABASE_URL=... npm run employment-record:backfill-status
 * Exit 0 always (informational report, not a pass/fail gate).
 */
import { PrismaClient } from '@prisma/client';
import { checkEmploymentRecordBackfillStatus } from './employment-record-backfill-status.js';

async function main() {
  const prisma = new PrismaClient();
  try {
    const report = await checkEmploymentRecordBackfillStatus(prisma);

    console.log(
      `[employment-record-backfill-status] ${report.totalActiveRosterWorkers} distinct ACTIVE HotelWorker worker_id(s) found.`
    );
    console.log(
      `[employment-record-backfill-status] ${report.withEmploymentRecord} have a corresponding EmploymentRecord.`
    );
    console.log(
      `[employment-record-backfill-status] ${report.withoutEmploymentRecord} have no corresponding EmploymentRecord.`
    );

    if (report.missing.length > 0) {
      console.log('[employment-record-backfill-status] Missing EmploymentRecord for:');
      for (const w of report.missing) {
        console.log(`  - worker_id=${w.worker_id} (seen on hotel_id=${w.hotel_id})`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[employment-record-backfill-status] ERROR:', err);
  process.exitCode = 1;
});

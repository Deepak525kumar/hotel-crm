/**
 * Epic 5 PR 5.8 — HotelWorker -> EmploymentRecord backfill status query.
 *
 * ADR-022 roadmap step 6 retired the `backend-hotel-workers` module (routes/
 * controller/service) and PR 5.7's `FEATURE_ROSTER_CUTOVER` flag: every
 * application read now goes through the PR 5.6 `EmploymentRecord` /
 * `lib/roster-scope.ts` group-grain seam, and the legacy `HotelWorker` table
 * is completely dormant — unread by any application code (schema-only,
 * ADR-022 Data Migration Plan: "No DROP TABLE").
 *
 * No backfill of `HotelWorker` rows into `EmploymentRecord` has ever been
 * built, and this module does NOT perform one. It exists purely to give a
 * human real data before any future decision about the `HotelWorker` table's
 * fate — read-only, no writes, no side effects.
 *
 * CLI entrypoint: run-employment-record-backfill-status.ts (kept separate so
 * this module stays free of import.meta/process-exit CLI concerns and is
 * plainly unit-testable).
 */
import { HotelWorkerStatus, PrismaClient } from '@prisma/client';

export interface ActiveRosterWorker {
  worker_id: string;
  hotel_id: string;
}

export interface EmploymentRecordBackfillStatusReport {
  totalActiveRosterWorkers: number;
  withEmploymentRecord: number;
  withoutEmploymentRecord: number;
  // Every distinct ACTIVE HotelWorker worker_id with no corresponding
  // EmploymentRecord, paired with one of the hotel_id rows it was found on
  // (a worker may hold ACTIVE membership at more than one hotel; the exact
  // hotel_id here is illustrative, not exhaustive).
  missing: ActiveRosterWorker[];
}

export async function checkEmploymentRecordBackfillStatus(
  prisma: Pick<PrismaClient, 'hotelWorker' | 'employmentRecord'>
): Promise<EmploymentRecordBackfillStatusReport> {
  const activeRosterWorkers = await prisma.hotelWorker.findMany({
    where: { status: HotelWorkerStatus.ACTIVE },
    select: { worker_id: true, hotel_id: true },
    distinct: ['worker_id'],
    orderBy: { worker_id: 'asc' },
  });

  const missing: ActiveRosterWorker[] = [];
  let withEmploymentRecord = 0;

  for (const row of activeRosterWorkers) {
    const record = await prisma.employmentRecord.findUnique({
      where: { user_id: row.worker_id },
      select: { user_id: true },
    });
    if (record) {
      withEmploymentRecord += 1;
    } else {
      missing.push(row);
    }
  }

  return {
    totalActiveRosterWorkers: activeRosterWorkers.length,
    withEmploymentRecord,
    withoutEmploymentRecord: missing.length,
    missing,
  };
}

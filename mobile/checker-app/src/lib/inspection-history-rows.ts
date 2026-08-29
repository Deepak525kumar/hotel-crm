import type { OwnInspection } from '@/types/api';

/**
 * Which action rows one inspection-history card shows.
 *
 * This used to reconcile TWO records per shift -- a Rating and a
 * QualityVerification, written by separate actions -- and its third row,
 * `record-verification`, existed only because a shift could have the first
 * without the second. Both went with the Rating merge (2026-08-29): there is
 * one record per inspection now, and `GET /quality/my-inspections` only
 * returns shifts that have one.
 *
 * Kept as a function rather than inlined because the screen still needs the
 * empty case, and because this project's jest config collects logic from
 * `.test.ts` -- a rule left inside a component is untested by construction.
 */
export type InspectionRowKind = 'verification';

export function inspectionHistoryRows(item: OwnInspection): InspectionRowKind[] {
  return item.verification ? ['verification'] : [];
}

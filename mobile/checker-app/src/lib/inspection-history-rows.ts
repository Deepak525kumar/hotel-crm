import type { OwnInspection } from '@/types/api';

/**
 * Which action rows one inspection-history card shows.
 *
 * Pure and separate from the screen so it is testable: this project's jest
 * config collects logic from `.test.ts`, so a rule left inside a component is
 * untested by construction — and this rule decides whether the app's only
 * route to "assign rework" is on screen at all.
 *
 * The three kinds:
 *
 *   - `rating` — the checklist score. Its photos are viewable nowhere else in
 *     the app; `GET /quality/ratings/:id/photos` has existed since CRR §15 and
 *     had no caller, so every photo attached to a rating was write-only.
 *   - `verification` — the pass/fail check. This is the road to the evidence
 *     screen, which is where rework is assigned (CRR §14).
 *   - `record-verification` — shown in the verification row's PLACE when none
 *     exists. This is the fix for rework being unreachable, not a convenience:
 *     the checker's own flow (Home -> Start checking -> select worker ->
 *     /rating/[id]) produces a Rating, while rework can only be assigned
 *     against a QualityVerification. Without an offer to record the second
 *     one, a checker can log inspections all day and still never reach the
 *     action the requirement names them for.
 *
 * A PASSED verification still gets a row. The evidence is worth seeing even
 * when nothing needs redoing, and whether rework is OFFERED is the evidence
 * screen's own rule (it hides the form for PASSED, and the server refuses it
 * regardless) — duplicating that judgement here would put two authorities on
 * one decision.
 */
export type InspectionRowKind = 'rating' | 'verification' | 'record-verification';

export function inspectionHistoryRows(item: OwnInspection): InspectionRowKind[] {
  const rows: InspectionRowKind[] = [];
  if (item.rating) rows.push('rating');
  rows.push(item.verification ? 'verification' : 'record-verification');
  return rows;
}

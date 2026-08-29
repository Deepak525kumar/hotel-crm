/**
 * TREQ-005 inspection checklist, mirrored client-side.
 *
 * Must equal backend/src/modules/quality/inspection-checklist.ts's
 * INSPECTION_CHECKLIST_ITEMS -- guarded by
 * __tests__/inspection-checklist-match-server.test.ts. That guard exists
 * because the same drift already shipped once: this app's DocumentCategory
 * union carried three members the server rejects and was missing four it
 * requires, and nothing compared the two lists.
 *
 * The server rejects any key outside this set (CreateRatingSchema uses
 * z.enum), so an unmirrored addition here is a 400 the checker cannot act on.
 */
export const INSPECTION_CHECKLIST_ITEMS = [
  'dust',
  'bathroom',
  'bed_linen',
  'mirror',
  'floor',
  'minibar_restocking',
  'fragrance_amenities',
  'other',
] as const;

export type InspectionChecklistItem = (typeof INSPECTION_CHECKLIST_ITEMS)[number];

/** i18n key for one item's label. */
export function checklistItemLabelKey(item: InspectionChecklistItem): string {
  return `quality.checklist.${item}`;
}

/**
 * The overall 0-100 score, averaged over the items the checker actually
 * scored.
 *
 * Derived rather than typed separately: the web form asks for both and lets
 * them disagree, which makes the headline number and the evidence behind it
 * tell different stories. Unscored items are skipped rather than counted as
 * zero -- "not assessed" is not "filthy".
 */
export function deriveOverallScore(scores: Partial<Record<InspectionChecklistItem, number>>): number | null {
  const values = Object.values(scores).filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Whether every supplied value is an integer in 0..100, matching the server. */
export function invalidChecklistItems(
  scores: Partial<Record<InspectionChecklistItem, number>>,
): InspectionChecklistItem[] {
  return (Object.entries(scores) as [InspectionChecklistItem, number | undefined][])
    .filter(([, v]) => v !== undefined && (!Number.isInteger(v) || v! < 0 || v! > 100))
    .map(([k]) => k);
}

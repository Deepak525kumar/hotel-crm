/**
 * TREQ-005 / TRULE-002 (CONFIRMED §15): the inspection checklist a checker
 * fills in alongside the 0-100 score.
 *
 * These eight items are the confirmed set. What shipped instead was
 * `{punctuality, quality, attitude}` -- a pre-pivot leftover describing the
 * WORKER rather than the ROOM, kept alive only by a comment on
 * Rating.criteria_scores and three inputs on the web rating form. The gap was
 * tracked the whole time as MIG-GAP-07; this closes it. Where the code and the
 * confirmed requirement disagreed, the requirement wins.
 *
 * Stored as JSON rather than columns because the set is a product decision
 * that has already changed once, and `criteria_scores` is already Json?.
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

/**
 * The pre-pivot keys. Retained for READS only.
 *
 * Ratings written before this change still carry these, and they are real
 * assessments of real people -- silently dropping them from a historical
 * record would be worse than showing a legacy label. They are rejected on
 * write (see CreateRatingSchema) so the set stops growing, but never deleted.
 */
export const LEGACY_CRITERIA_KEYS = ['punctuality', 'quality', 'attitude'] as const;

export function isInspectionChecklistItem(key: string): key is InspectionChecklistItem {
  return (INSPECTION_CHECKLIST_ITEMS as readonly string[]).includes(key);
}

export function isLegacyCriteriaKey(key: string): boolean {
  return (LEGACY_CRITERIA_KEYS as readonly string[]).includes(key);
}

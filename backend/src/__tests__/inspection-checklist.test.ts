import { RecordInspectionSchema } from '../modules/quality/types';
import {
  INSPECTION_CHECKLIST_ITEMS,
  LEGACY_CRITERIA_KEYS,
} from '../modules/quality/inspection-checklist';

// RecordInspectionSchema replaced CreateRatingSchema when Rating was merged
// into QualityVerification (2026-08-29). Two shape differences matter here:
// `outcome` is required, and `criteria_scores` arrives as a JSON STRING
// because multipart cannot carry a nested object.
const base = {
  assignment_id: 'a1',
  worker_id: 'w1',
  score: 80,
  outcome: 'complete' as const,
};

/** The checklist as the endpoint actually receives it. */
const withChecklist = (criteria: Record<string, unknown>) => ({
  ...base,
  criteria_scores: JSON.stringify(criteria),
});

describe('inspection checklist (TREQ-005 / MIG-GAP-07)', () => {
  it('is exactly the confirmed set from CONFIRMED §15', () => {
    // Pinned deliberately. This list is a product decision, not an
    // implementation detail -- if it changes, the change should be a visible
    // edit to this assertion and to the spec, not a silent drift.
    expect([...INSPECTION_CHECKLIST_ITEMS]).toEqual([
      'dust',
      'bathroom',
      'bed_linen',
      'mirror',
      'floor',
      'minibar_restocking',
      'fragrance_amenities',
      'other',
    ]);
  });

  it('accepts every confirmed item', () => {
    const criteria_scores = Object.fromEntries(
      INSPECTION_CHECKLIST_ITEMS.map((item, i) => [item, i * 10])
    );
    const parsed = RecordInspectionSchema.safeParse(withChecklist(criteria_scores));
    expect(parsed.success).toBe(true);
  });

  it('accepts a partial checklist -- every item is optional', () => {
    const parsed = RecordInspectionSchema.safeParse(withChecklist({ bathroom: 90 }));
    expect(parsed.success).toBe(true);
  });

  it('rejects the pre-pivot keys, which the old schema accepted silently', () => {
    // This is the actual defect: `z.record(z.string(), z.number())` validated
    // {punctuality, quality, attitude} happily, so the divergence from
    // CONFIRMED §15 never surfaced anywhere.
    for (const key of LEGACY_CRITERIA_KEYS) {
      const parsed = RecordInspectionSchema.safeParse(withChecklist({ [key]: 80 }));
      expect(parsed.success).toBe(false);
    }
  });

  it('rejects an unknown key', () => {
    const parsed = RecordInspectionSchema.safeParse(withChecklist({ teleportation: 100 }));
    expect(parsed.success).toBe(false);
  });

  it('enforces the 0-100 scale the old schema did not', () => {
    for (const bad of [-1, 101, 5000, 12.5]) {
      const parsed = RecordInspectionSchema.safeParse(withChecklist({ dust: bad }));
      expect(parsed.success).toBe(false);
    }
  });

  it('still allows omitting the checklist entirely', () => {
    expect(RecordInspectionSchema.safeParse(base).success).toBe(true);
  });
});

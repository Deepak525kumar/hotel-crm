import { inspectionHistoryRows } from '@/lib/inspection-history-rows';
import type { OwnInspection } from '@/types/api';

const RATING: NonNullable<OwnInspection['rating']> = {
  id: 'rating-1',
  score: 80,
  comment: null,
  criteria_scores: { mirror: 40 },
  photo_count: 2,
  created_at: '2026-08-26T11:00:00.000Z',
};

const VERIFICATION: NonNullable<OwnInspection['verification']> = {
  id: 'verif-1',
  score: 45,
  status: 'NEEDS_REWORK',
  notes: null,
  photo_count: 1,
  rework_required: false,
  rework_notes: null,
  rework_completed_at: null,
  created_at: '2026-08-26T11:05:00.000Z',
};

function inspection(over: Partial<OwnInspection> = {}): OwnInspection {
  return {
    assignment_id: 'assign-1',
    day: '2026-08-26',
    worker: { id: 'w1', first_name: 'Ana', last_name: 'Silva' },
    hotel: { id: 'h1', name: 'Grand', city: 'Berlin' },
    rating: null,
    verification: null,
    ...over,
  };
}

describe('inspection history rows', () => {
  it('offers to record a verification when the shift was only rated', () => {
    // THE rework fix. The checker's own flow (Start checking -> select worker
    // -> /rating/[id]) writes a Rating, but rework can only be assigned
    // against a QualityVerification. Without this row a checker can log
    // inspections indefinitely and never reach "assign rework" at all.
    expect(inspectionHistoryRows(inspection({ rating: RATING }))).toEqual([
      'rating',
      'record-verification',
    ]);
  });

  it('shows the verification row instead of the offer once one exists', () => {
    expect(
      inspectionHistoryRows(inspection({ rating: RATING, verification: VERIFICATION }))
    ).toEqual(['rating', 'verification']);
  });

  it('never shows both the verification row and the offer to record one', () => {
    // They occupy the same slot by construction. Two rows would mean offering
    // to create a second QualityVerification for an assignment that already
    // has one -- assignment_id is @unique on that table, so the server would
    // answer 409 and the affordance would be a lie.
    for (const item of [
      inspection({ rating: RATING }),
      inspection({ verification: VERIFICATION }),
      inspection({ rating: RATING, verification: VERIFICATION }),
    ]) {
      const rows = inspectionHistoryRows(item);
      expect(rows.filter((r) => r === 'verification' || r === 'record-verification')).toHaveLength(
        1
      );
    }
  });

  it('still shows a PASSED verification', () => {
    // Whether rework is OFFERED is the evidence screen's rule, not this one.
    // Hiding a passed inspection here would also hide its photos, which are
    // worth seeing regardless of the outcome.
    expect(
      inspectionHistoryRows(
        inspection({ verification: { ...VERIFICATION, status: 'PASSED', score: 90 } })
      )
    ).toEqual(['verification']);
  });

  it('omits the rating row when this checker did not rate the shift', () => {
    // The server nulls a colleague's record, so `rating: null` here means
    // "not mine", not merely "absent" -- and a row leading to someone else's
    // evidence would be wrong on a screen titled with the caller's own work.
    expect(inspectionHistoryRows(inspection({ verification: VERIFICATION }))).toEqual([
      'verification',
    ]);
  });

  it('always yields at least one row', () => {
    // The endpoint only returns an assignment when at least one record is the
    // caller's, so a card can never be empty; if both are null the offer to
    // record a verification is still the honest thing to show.
    expect(inspectionHistoryRows(inspection()).length).toBeGreaterThan(0);
  });
});

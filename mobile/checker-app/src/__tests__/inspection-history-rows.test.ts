import { inspectionHistoryRows } from '@/lib/inspection-history-rows';
import type { OwnInspection } from '@/types/api';

/**
 * One record per inspection since the Rating merge (2026-08-29).
 *
 * This file used to cover the reconciliation of TWO records on one shift --
 * which to show, which to drop when a colleague wrote it, and the
 * "record a pass/fail check" offer for a shift that had a rating and no
 * verification. None of those states can occur now, so the tests that
 * described them were deleted rather than rewritten: keeping them would
 * assert behaviour the data model no longer permits.
 */
const VERIFICATION: NonNullable<OwnInspection['verification']> = {
  id: 'verif-1',
  score: 45,
  status: 'NEEDS_REWORK',
  notes: null,
  criteria_scores: { mirror: 40 },
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
    verification: null,
    ...over,
  };
}

describe('inspection history rows', () => {
  it('shows the check', () => {
    expect(inspectionHistoryRows(inspection({ verification: VERIFICATION }))).toEqual([
      'verification',
    ]);
  });

  it('shows a PASSED check too', () => {
    // Whether rework is OFFERED is the evidence screen's rule, not this one.
    // Hiding a passed inspection here would also hide its photos and its
    // checklist, which are worth seeing regardless of outcome.
    expect(
      inspectionHistoryRows(
        inspection({ verification: { ...VERIFICATION, status: 'PASSED', score: 90 } })
      )
    ).toEqual(['verification']);
  });

  it('shows nothing for a shift with no check', () => {
    // Defensive only: GET /quality/my-inspections filters on the check's
    // author, so a row without one cannot come back. An empty card is still
    // better than a crash if that ever changes.
    expect(inspectionHistoryRows(inspection())).toEqual([]);
  });
});

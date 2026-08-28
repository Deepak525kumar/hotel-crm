import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';

import {
  ATTENDANCE_WEIGHT,
  QUALITY_WEIGHT,
  attendanceScore,
  blendQualityAndAttendance,
} from '../modules/quality/overall-rating.js';
import { RECENT_WEIGHT, LIFETIME_WEIGHT } from '../modules/quality/recency-weighting.js';

/**
 * overall = 0.7 x quality + 0.3 x attendance (owner decision, 2026-08-29).
 */
describe('the weights', () => {
  it('sum to 1', () => {
    expect(QUALITY_WEIGHT + ATTENDANCE_WEIGHT).toBeCloseTo(1);
  });

  it('are a DIFFERENT 70/30 from recency-weighting', () => {
    // Both modules split 70/30, on unrelated axes: recency splits recent-10
    // against lifetime WITHIN the quality figure; this one splits that figure
    // against attendance. They happen to share numbers today, which is exactly
    // why a future change to one must not be made by editing the other. This
    // test exists to be read, not to catch a bug.
    expect(QUALITY_WEIGHT).toBe(RECENT_WEIGHT);
    expect(ATTENDANCE_WEIGHT).toBe(LIFETIME_WEIGHT);
    const src = readFileSync('src/modules/quality/overall-rating.ts', 'utf8');
    expect(src).toMatch(/recency-weighting/);
    expect(src).toMatch(/different axis/i);
  });
});

describe('attendanceScore — turned up, over completed + no-show', () => {
  it('is the share of due shifts the worker completed', () => {
    expect(attendanceScore(8, 10)).toBe(80);
    expect(attendanceScore(10, 10)).toBe(100);
  });

  it('is 0 when they were due and never turned up', () => {
    // Distinct from null below: this worker HAS a record, and it is bad.
    expect(attendanceScore(0, 4)).toBe(0);
  });

  it('is null when nothing is due yet, not 0', () => {
    // 0 would say "did not turn up" about a worker who has not been asked to.
    expect(attendanceScore(0, 0)).toBeNull();
  });
});

describe('blendQualityAndAttendance', () => {
  it('applies 70/30', () => {
    expect(blendQualityAndAttendance(90, 80)).toBeCloseTo(87);
    expect(blendQualityAndAttendance(60, 80)).toBeCloseTo(66);
  });

  it('returns null when the worker has never been inspected', () => {
    // Owner decision: blank, not a number. 70% of the formula has no input.
    expect(blendQualityAndAttendance(null, 100)).toBeNull();
    expect(blendQualityAndAttendance(null, 0)).toBeNull();
    expect(blendQualityAndAttendance(null, null)).toBeNull();
  });

  it('never lets a spotless new worker be scored 30', () => {
    // The trap this rule exists to avoid: 0.7*0 + 0.3*100 = 30 trips the
    // below-50 alert and pushes "your rating has dropped" to the worker and
    // their regional manager before anyone has looked at their work.
    expect(blendQualityAndAttendance(null, 100)).not.toBe(30);
  });

  it('falls back to quality alone when nothing is due yet', () => {
    // An inspected worker with no COMPLETED/NO_SHOW shifts has a real quality
    // figure and no attendance record. Blending against nothing would halve
    // their score for having been hired recently.
    expect(blendQualityAndAttendance(90, null)).toBe(90);
  });

  it('a perfect worker scores 100 and a total failure scores 0', () => {
    expect(blendQualityAndAttendance(100, 100)).toBeCloseTo(100);
    expect(blendQualityAndAttendance(0, 0)).toBeCloseTo(0);
  });

  it('quality moves the result more than attendance does', () => {
    // The 70/30 ordering, asserted as behaviour rather than as two constants.
    const base = blendQualityAndAttendance(50, 50)!;
    const betterQuality = blendQualityAndAttendance(60, 50)!;
    const betterAttendance = blendQualityAndAttendance(50, 60)!;
    expect(betterQuality - base).toBeGreaterThan(betterAttendance - base);
  });
});

describe('the aggregate reads checks, and only settled shifts', () => {
  const src = () => readFileSync('src/modules/quality/service.ts', 'utf8');
  const refresh = () => {
    const s = src();
    const start = s.indexOf('export async function refreshWorkerOverallRating');
    return s.slice(start, s.indexOf('\nexport ', start + 10));
  };

  it('takes the quality figure from QualityVerification, not Rating', () => {
    const body = refresh();
    expect(body).toContain('tx.qualityVerification.aggregate');
    expect(body).toContain('tx.qualityVerification.findMany');
    expect(body).not.toContain('tx.rating.aggregate');
    expect(body).not.toContain('tx.rating.findMany');
  });

  it('scopes checks to the inspected WORKER, not the checker', () => {
    // QualityVerification has no worker_id; the worker is reached through the
    // assignment. Filtering on verified_by_id would score the checker.
    expect(refresh()).toContain('assignment: { worker_id }');
  });

  it('counts only COMPLETED and NO_SHOW as due', () => {
    const body = refresh();
    expect(body).toContain('status: { in: [AssignmentStatus.COMPLETED, AssignmentStatus.NO_SHOW] }');
    // The removed arm: CONFIRMED/IN_PROGRESS whose day had passed. Those have
    // no outcome yet, so counting them scored unfinished shifts.
    //
    // Asserted on the `today` binding the arm needed, not on the arm's own
    // text -- the explanatory comment above the predicate quotes that text,
    // and a substring check turned the explanation into a failure.
    expect(body).not.toMatch(/const today = new Date/);
    expect(body).not.toMatch(/status: \{ in: \[AssignmentStatus\.CONFIRMED/);
  });

  it('still excludes rework rows from the denominator (ADR-069 §3)', () => {
    expect(refresh()).toContain('rework_of_assignment_id: null');
  });

  it('gates warnings on having at least one check', () => {
    // Without this an unrated worker's stored 0 reads as "below 50".
    expect(refresh()).toContain('totalAssignments > 0 && agg._count > 0');
  });
});

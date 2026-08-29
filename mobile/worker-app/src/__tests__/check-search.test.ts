import { describe, it, expect } from '@jest/globals';
import { matchesCheck, SEARCH_THRESHOLD } from '@/lib/check-search';
import type { QualityCheck } from '@/types/api';

/**
 * Search on the worker's shift screen (owner decision, 2026-08-30).
 *
 * The case that matters is a ~100-room shift, where the list is unusable
 * without it. These assert the behaviours that make the box trustworthy: it
 * finds what the worker can see on the row, in their own language, and an
 * empty box is not a filter.
 */
const check = (over: Partial<QualityCheck> = {}): QualityCheck =>
  ({
    id: 'c1',
    assignment_id: 'a1',
    room_number: '412',
    score: 90,
    status: 'PASSED',
    notes: 'Balcony door left open',
    photo_count: 1,
    rework_required: false,
    rework_completed_at: null,
    created_at: '2026-08-30T10:00:00.000Z',
    ...over,
  }) as QualityCheck;

describe('matchesCheck', () => {
  it('matches on room number, the thing the worker is looking for', () => {
    expect(matchesCheck(check(), '412', 'PASSED')).toBe(true);
    expect(matchesCheck(check(), '413', 'PASSED')).toBe(false);
  });

  it('matches a partial room number', () => {
    // Typing "41" while looking for 412 must not return nothing.
    expect(matchesCheck(check(), '41', 'PASSED')).toBe(true);
  });

  it('matches the checker’s note', () => {
    expect(matchesCheck(check(), 'balcony', 'PASSED')).toBe(true);
  });

  it('is case-insensitive', () => {
    // A case-sensitive search returns nothing rather than saying it cannot
    // help, which reads to the worker as "no such room".
    expect(matchesCheck(check({ room_number: 'Suite A' }), 'suite a', 'PASSED')).toBe(true);
    expect(matchesCheck(check(), 'BALCONY', 'PASSED')).toBe(true);
  });

  it('matches the TRANSLATED outcome, not the raw enum', () => {
    // The worker sees the translated label on the row. Matching `status`
    // directly would work in English only, by coincidence.
    const c = check({ status: 'NEEDS_REWORK' });
    expect(matchesCheck(c, 'nacharbeit', 'NACHARBEIT ERFORDERLICH')).toBe(true);
    expect(matchesCheck(c, 'NEEDS_REWORK', 'NACHARBEIT ERFORDERLICH')).toBe(false);
  });

  it('treats an empty box as no filter, not as a filter matching nothing', () => {
    expect(matchesCheck(check(), '', 'PASSED')).toBe(true);
    expect(matchesCheck(check(), '   ', 'PASSED')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    // Mobile keyboards add a trailing space after autocorrect; without the
    // trim the list would empty as soon as the worker stopped typing.
    expect(matchesCheck(check(), '  412  ', 'PASSED')).toBe(true);
  });

  it('survives a check with no notes', () => {
    expect(matchesCheck(check({ notes: null }), 'balcony', 'PASSED')).toBe(false);
    expect(matchesCheck(check({ notes: null }), '412', 'PASSED')).toBe(true);
  });

  it('does not treat % or _ as wildcards', () => {
    // The server-side search escapes these (a bare % once returned every row).
    // This filter is plain string containment, so the same input must simply
    // not match -- asserted so the two searches cannot drift apart.
    expect(matchesCheck(check(), '%', 'PASSED')).toBe(false);
    expect(matchesCheck(check(), '_', 'PASSED')).toBe(false);
  });
});

describe('SEARCH_THRESHOLD', () => {
  it('hides the box on a shift small enough to read by scrolling', () => {
    expect(SEARCH_THRESHOLD).toBe(5);
  });
});

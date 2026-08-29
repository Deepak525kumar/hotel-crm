import { describe, it, expect } from '@jest/globals';
import { matchesCheck, matchesShift, SEARCH_THRESHOLD } from '@/lib/check-search';
import type { QualityCheck, WorkerAssignment } from '@/types/api';

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

  it('matches an English outcome typed with an underscore or a space', () => {
    // The label reads "NEEDS REWORK"; the enum is NEEDS_REWORK. Both forms
    // reach the box, and neither should return nothing.
    const c = check({ status: 'NEEDS_REWORK' });
    expect(matchesCheck(c, 'needs rework', 'NEEDS REWORK')).toBe(true);
    expect(matchesCheck(c, 'needs_rework', 'NEEDS REWORK')).toBe(true);
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

  it('does not let the status underscore-folding leak into notes', () => {
    // Underscores are folded to spaces for STATUS only. Folding them
    // everywhere made a bare '_' a search for ' ', which matched every check
    // whose note contained a space -- the same defect class as the unescaped
    // LIKE '_' on the server, reached by a different route.
    const spaced = check({ notes: 'has spaces in it', room_number: '412' });
    expect(matchesCheck(spaced, '_', 'PASSED')).toBe(false);
    // And a room genuinely containing an underscore is still found literally.
    expect(matchesCheck(check({ room_number: 'A_1' }), 'A_1', 'PASSED')).toBe(true);
  });
});

describe('SEARCH_THRESHOLD', () => {
  it('hides the box on a shift small enough to read by scrolling', () => {
    expect(SEARCH_THRESHOLD).toBe(5);
  });
});

const shift = (over: Partial<WorkerAssignment> = {}): WorkerAssignment =>
  ({
    id: 's1',
    worker_id: 'w1',
    status: 'IN_PROGRESS',
    day: '2026-08-30',
    hotel: { id: 'h1', name: 'Grand Hotel', city: 'Berlin' },
    created_at: '2026-08-30T08:00:00.000Z',
    ...over,
  }) as WorkerAssignment;

describe('matchesShift', () => {
  it('matches hotel name and city', () => {
    expect(matchesShift(shift(), 'grand', 'IN PROGRESS')).toBe(true);
    expect(matchesShift(shift(), 'berlin', 'IN PROGRESS')).toBe(true);
    expect(matchesShift(shift(), 'munich', 'IN PROGRESS')).toBe(false);
  });

  it('matches the ISO day, so a month or a date can be searched', () => {
    // The card shows a formatted date, but the ISO form is what someone
    // scanning for a specific day actually types.
    expect(matchesShift(shift(), '2026-08', 'IN PROGRESS')).toBe(true);
    expect(matchesShift(shift(), '08-30', 'IN PROGRESS')).toBe(true);
    expect(matchesShift(shift(), '2025', 'IN PROGRESS')).toBe(false);
  });

  it('matches the status whether typed spaced or underscored', () => {
    // The badge renders "IN PROGRESS"; the value behind it is IN_PROGRESS.
    // A worker may type either, and neither should silently return nothing.
    expect(matchesShift(shift(), 'in progress', 'IN PROGRESS')).toBe(true);
    expect(matchesShift(shift(), 'IN_PROGRESS', 'IN PROGRESS')).toBe(true);
    expect(matchesShift(shift(), 'progress', 'IN PROGRESS')).toBe(true);
  });

  it('survives a calendar-placed shift with no hotel and no day', () => {
    // Both fields are optional on the DTO; a missing hotel must not throw and
    // must not match everything either.
    const bare = shift({ hotel: null, day: undefined });
    expect(matchesShift(bare, 'grand', 'CONFIRMED')).toBe(false);
    expect(matchesShift(bare, '', 'CONFIRMED')).toBe(true);
    expect(matchesShift(bare, 'confirmed', 'CONFIRMED')).toBe(true);
  });

  it('treats an empty box as no filter', () => {
    expect(matchesShift(shift(), '   ', 'IN PROGRESS')).toBe(true);
  });
});

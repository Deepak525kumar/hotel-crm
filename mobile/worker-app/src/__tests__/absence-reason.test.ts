import { describe, it, expect } from '@jest/globals';
import {
  ABSENCE_REASON_MAX_LENGTH,
  normalizeAbsenceReason,
  validateAbsenceReason,
} from '@/lib/absence-reason';

/**
 * Absence reason rule.
 *
 * Verified against the running backend before the fix: the apps offered SICK
 * and VACATION as one-tap buttons and sent only {day, kind}, so vacation was
 * rejected every time.
 *
 *   POST /calendar/my-absences {day, kind: "VACATION"} -> 422 "reason is required for a VACATION absence"
 *   POST /calendar/my-absences {day, kind: "SICK"}     -> 200
 */
describe('validateAbsenceReason', () => {
  it('requires a reason for VACATION', () => {
    expect(validateAbsenceReason('VACATION', undefined)).toBe('required');
    expect(validateAbsenceReason('VACATION', '')).toBe('required');
  });

  it('treats a whitespace-only reason as missing', () => {
    // Otherwise the client would send "   ", which the backend's .min(1) on a
    // trimmed string rejects anyway — with a worse message.
    expect(validateAbsenceReason('VACATION', '   ')).toBe('required');
  });

  it('accepts any non-empty reason for VACATION', () => {
    expect(validateAbsenceReason('VACATION', 'family trip')).toBeNull();
  });

  it('does NOT require a reason for SICK', () => {
    // Deliberate, and mirrored from the backend: requiring one would
    // incentivise disclosing health details (GDPR special-category data) on
    // what this model keeps as a plain flag.
    expect(validateAbsenceReason('SICK', undefined)).toBeNull();
    expect(validateAbsenceReason('SICK', '')).toBeNull();
  });

  it('rejects a reason longer than the backend allows', () => {
    expect(validateAbsenceReason('SICK', 'x'.repeat(ABSENCE_REASON_MAX_LENGTH + 1))).toBe('tooLong');
    expect(validateAbsenceReason('VACATION', 'x'.repeat(ABSENCE_REASON_MAX_LENGTH))).toBeNull();
  });
});

describe('normalizeAbsenceReason', () => {
  it('omits an empty reason rather than sending ""', () => {
    // The backend field is .min(1) when present, so "" would 422 even for SICK.
    expect(normalizeAbsenceReason('')).toBeUndefined();
    expect(normalizeAbsenceReason('   ')).toBeUndefined();
    expect(normalizeAbsenceReason(undefined)).toBeUndefined();
  });

  it('trims what it does send', () => {
    expect(normalizeAbsenceReason('  family trip  ')).toBe('family trip');
  });
});

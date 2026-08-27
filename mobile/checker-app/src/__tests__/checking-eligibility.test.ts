import { resolveCheckingEligibility } from '@/lib/checking-eligibility';
import type { AttendanceRecord } from '@/types/api';

const base: AttendanceRecord = {
  id: 'a1',
  assignment_id: 'as1',
  worker_id: 'c1',
  hotel_id: 'h1',
  status: 'PRESENT',
  check_in_at: null,
  check_out_at: null,
  expected_start: null,
  expected_end: null,
  minutes_late: null,
  minutes_worked: null,
  notes: null,
  is_verified: false,
  verified_by_id: null,
  verified_at: null,
  created_at: '2026-08-27T00:00:00.000Z',
  updated_at: '2026-08-27T00:00:00.000Z',
};

/**
 * An ISO timestamp at a given LOCAL hour on a given day. Built from local
 * components rather than a UTC literal so the assertions mean the same thing
 * wherever the suite runs — `${day}T09:00:00Z` is the previous day locally
 * anywhere west of UTC, which would make the yesterday case pass for the
 * wrong reason.
 */
function at(day: string, hour: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
}

const TODAY = '2026-08-27';
const YESTERDAY = '2026-08-26';

describe('resolveCheckingEligibility', () => {
  it('allows checking while checked in and not yet checked out', () => {
    const r = resolveCheckingEligibility([{ ...base, check_in_at: at(TODAY, 9) }], TODAY);
    expect(r).toEqual({ allowed: true, reason: null, attendanceId: 'a1' });
  });

  it('blocks once checked out — the whole point of the gate', () => {
    const r = resolveCheckingEligibility(
      [{ ...base, check_in_at: at(TODAY, 9), check_out_at: at(TODAY, 17) }],
      TODAY,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('CHECKED_OUT');
    // The row is still returned: the screen shows what happened, not just "no".
    expect(r.attendanceId).toBe('a1');
  });

  it('says NOT_CHECKED_IN when a shift is scheduled today but not started', () => {
    const r = resolveCheckingEligibility([{ ...base, expected_start: at(TODAY, 9) }], TODAY);
    expect(r).toEqual({ allowed: false, reason: 'NOT_CHECKED_IN', attendanceId: null });
  });

  it('says NO_SHIFT_TODAY when nothing is scheduled — a different message, not the same block', () => {
    const r = resolveCheckingEligibility([], TODAY);
    expect(r).toEqual({ allowed: false, reason: 'NO_SHIFT_TODAY', attendanceId: null });
  });

  it("does not treat yesterday's unclosed check-in as being on shift", () => {
    // The failure this guards: a shift never checked out would otherwise leave
    // the button live forever.
    const r = resolveCheckingEligibility([{ ...base, check_in_at: at(YESTERDAY, 9) }], TODAY);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('NO_SHIFT_TODAY');
  });

  it('allows when a second shift is open after an earlier one was closed', () => {
    const r = resolveCheckingEligibility(
      [
        { ...base, id: 'morning', check_in_at: at(TODAY, 7), check_out_at: at(TODAY, 11) },
        { ...base, id: 'afternoon', check_in_at: at(TODAY, 13) },
      ],
      TODAY,
    );
    expect(r).toEqual({ allowed: true, reason: null, attendanceId: 'afternoon' });
  });

  it('is order-independent — the open row wins wherever it sits', () => {
    const r = resolveCheckingEligibility(
      [
        { ...base, id: 'afternoon', check_in_at: at(TODAY, 13) },
        { ...base, id: 'morning', check_in_at: at(TODAY, 7), check_out_at: at(TODAY, 11) },
      ],
      TODAY,
    );
    expect(r.attendanceId).toBe('afternoon');
  });
});

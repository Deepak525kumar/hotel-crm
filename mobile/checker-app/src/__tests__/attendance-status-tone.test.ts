import { attendanceStatusTone } from '@/lib/attendance-status-tone';

describe('attendanceStatusTone', () => {
  it('separates the outcomes a checker acts on', () => {
    expect(attendanceStatusTone('PRESENT')).toBe('success');
    expect(attendanceStatusTone('LATE')).toBe('warning');
    expect(attendanceStatusTone('ABSENT')).toBe('danger');
  });

  // A record still awaiting a check-in is not an outcome and must not read as
  // one -- it was previously painted the same grey as an unknown status.
  it('treats EXPECTED as neutral, not an outcome', () => {
    expect(attendanceStatusTone('EXPECTED')).toBe('neutral');
  });

  it('falls back to neutral for an unrecognised status', () => {
    expect(attendanceStatusTone('SOMETHING_NEW')).toBe('neutral');
  });
});

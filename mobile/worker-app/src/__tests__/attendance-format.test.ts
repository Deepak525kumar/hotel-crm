import { formatDuration, workedMinutes } from '@/lib/attendance-format';
import type { Attendance } from '@/types/api';

const base = { id: 'a', assignment_id: 'x', worker_id: 'w', status: 'PRESENT', created_at: '' } as Attendance;

describe('workedMinutes', () => {
  it('measures a completed shift', () => {
    expect(workedMinutes({ ...base, check_in_at: '2026-08-26T08:00:00Z', check_out_at: '2026-08-26T15:30:00Z' })).toBe(450);
  });

  it('returns null while the shift is still open', () => {
    expect(workedMinutes({ ...base, check_in_at: '2026-08-26T08:00:00Z', check_out_at: null })).toBeNull();
    expect(workedMinutes({ ...base, check_in_at: null, check_out_at: null })).toBeNull();
  });

  // Clock skew between devices has produced check-outs before check-ins; a
  // negative duration must not render as "-3h".
  it('returns null when check-out precedes check-in', () => {
    expect(workedMinutes({ ...base, check_in_at: '2026-08-26T15:00:00Z', check_out_at: '2026-08-26T08:00:00Z' })).toBeNull();
  });
});

describe('formatDuration', () => {
  it('drops the hour part below an hour', () => {
    expect(formatDuration(45)).toBe('45m');
  });

  it('shows hours and minutes', () => {
    expect(formatDuration(450)).toBe('7h 30m');
  });
});

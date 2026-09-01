import { isoDateInCalendarTimezone } from '@/lib/calendar-dates';

/**
 * Which shift the Log Rooms tab logs against.
 *
 * Reported live: "shift ended more than two hours ago" while standing in an
 * IN_PROGRESS shift. The tab read "today" as `new Date().toISOString()` --
 * the UTC date -- while the server dates shifts in Europe/Berlin. From 22:00
 * UTC onwards those are different days, so the tab skipped the in-progress
 * shift (dated tomorrow in Berlin) and picked the previous day's COMPLETED
 * one, which the server then refused, correctly, for being long over.
 *
 * This pins the selection rule itself rather than the screen: an IN_PROGRESS
 * shift wins outright, and the day comparison -- used only for the finished
 * shift still inside its grace -- is Berlin's, not UTC's.
 */
type Assignment = {
  id: string;
  day: string;
  status: string;
  rework_of_assignment_id: string | null;
};

/** The rule as the screen applies it. */
function selectLoggableShift(assignments: Assignment[], today: string) {
  const loggable = assignments.filter((a) => !a.rework_of_assignment_id);
  const inProgress = loggable.find((a) => a.status === 'IN_PROGRESS');
  if (inProgress) return inProgress;
  return loggable.find((a) => a.day === today && a.status === 'COMPLETED');
}

describe('Log Rooms picks the shift the worker is actually in', () => {
  // The exact production shape: 23:49 UTC on 09-01 is 01:49 Berlin on 09-02.
  const shifts: Assignment[] = [
    { id: 'in-progress', day: '2026-09-02', status: 'IN_PROGRESS', rework_of_assignment_id: null },
    { id: 'yesterday-done', day: '2026-09-01', status: 'COMPLETED', rework_of_assignment_id: null },
  ];

  it('prefers the in-progress shift over a finished one, whatever the date says', () => {
    // Even handed the UTC day, which is what produced the bug.
    expect(selectLoggableShift(shifts, '2026-09-01')?.id).toBe('in-progress');
    expect(selectLoggableShift(shifts, '2026-09-02')?.id).toBe('in-progress');
  });

  it('falls back to the day\'s finished shift when none is in progress', () => {
    const finishedOnly = shifts.filter((s) => s.status === 'COMPLETED');
    expect(selectLoggableShift(finishedOnly, '2026-09-01')?.id).toBe('yesterday-done');
    // A finished shift from another day is not offered.
    expect(selectLoggableShift(finishedOnly, '2026-09-02')).toBeUndefined();
  });

  it('never logs against a rework shift', () => {
    const rework: Assignment[] = [
      { id: 'rw', day: '2026-09-02', status: 'IN_PROGRESS', rework_of_assignment_id: 'orig' },
    ];
    expect(selectLoggableShift(rework, '2026-09-02')).toBeUndefined();
  });

  // The helper the screen now uses; the bug was reading the UTC date instead.
  it('anchors today to Europe/Berlin, not UTC', () => {
    const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
    expect(isoDateInCalendarTimezone(0)).toBe(berlin);
  });
});

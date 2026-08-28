import { buildAgenda, shiftDays } from '@/lib/calendar-agenda';
import type { CalendarAbsence, WorkerAssignment } from '@/types/api';

/**
 * The calendar screen showed absences only, so it answered "which days did I
 * mark off" but never "what am I doing this week" — the two halves of one
 * question lived on two tabs.
 */
function absence(over: Partial<CalendarAbsence> = {}): CalendarAbsence {
  return {
    id: 'abs-1',
    worker_id: 'w1',
    day: '2026-09-02',
    kind: 'SICK',
    reason: null,
    marked_by_id: 'w1',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...over,
  } as CalendarAbsence;
}

function shift(over: Partial<WorkerAssignment> = {}): WorkerAssignment {
  return {
    id: 'asg-1',
    work_request_id: '',
    worker_id: 'w1',
    status: 'CONFIRMED',
    created_at: '2026-09-01T00:00:00.000Z',
    day: '2026-09-03',
    ...over,
  } as WorkerAssignment;
}

describe('calendar agenda', () => {
  it('puts shifts and absences on one timeline, in date order', () => {
    const agenda = buildAgenda(
      [absence({ id: 'a', day: '2026-09-05' })],
      [shift({ id: 's', day: '2026-09-03' })]
    );

    expect(agenda.map((e) => [e.day, e.kind])).toEqual([
      ['2026-09-03', 'shift'],
      ['2026-09-05', 'absence'],
    ]);
  });

  it('reads the assignment day from the denormalized column', () => {
    // `day` is what every creation path writes since Epic 9 PR 9.6, and every
    // shift in production is calendar-placed with work_request null.
    const [entry] = buildAgenda([], [shift({ day: '2026-09-07' })]);
    expect(entry!.day).toBe('2026-09-07');
  });

  it('falls back to work_request.shift_date for older rows', () => {
    const [entry] = buildAgenda(
      [],
      [shift({ day: undefined, work_request: { shift_date: '2026-09-08' } as never })]
    );
    expect(entry!.day).toBe('2026-09-08');
  });

  it('tolerates a full ISO timestamp in either field', () => {
    // Both are date-only server-side but serialize as UTC midnight. Sliced,
    // never re-projected: converting would move the day backwards for any
    // viewer west of UTC.
    const [entry] = buildAgenda([], [shift({ day: '2026-09-09T00:00:00.000Z' })]);
    expect(entry!.day).toBe('2026-09-09');
  });

  it('drops a shift with no resolvable day rather than guessing one', () => {
    // Bucketing it under today would put it on a date it is not on and let
    // someone plan around a fiction.
    expect(buildAgenda([], [shift({ day: undefined, work_request: undefined })])).toEqual([]);
  });

  it('hides REASSIGNED, which is the same work listed twice', () => {
    expect(buildAgenda([], [shift({ status: 'REASSIGNED' })])).toEqual([]);
  });

  it('keeps CANCELLED, because that is what a sick day does to a shift', () => {
    // Marking a day sick auto-cancels that day's shift. Hiding the result
    // answers "where did my shift go?" with silence.
    const agenda = buildAgenda([absence()], [shift({ status: 'CANCELLED', day: '2026-09-02' })]);
    expect(agenda).toHaveLength(2);
  });

  it('orders the absence before the shift it cancelled, on a shared day', () => {
    const agenda = buildAgenda(
      [absence({ day: '2026-09-02' })],
      [shift({ status: 'CANCELLED', day: '2026-09-02' })]
    );
    expect(agenda.map((e) => e.kind)).toEqual(['absence', 'shift']);
  });

  it('drops entries before `from`, so the list is what is still ahead', () => {
    const agenda = buildAgenda(
      [absence({ id: 'old', day: '2026-08-01' }), absence({ id: 'new', day: '2026-09-02' })],
      [shift({ id: 'olds', day: '2026-08-02' }), shift({ id: 'news', day: '2026-09-03' })],
      { from: '2026-09-01' }
    );
    expect(agenda.map((e) => e.day)).toEqual(['2026-09-02', '2026-09-03']);
  });

  it('is stable within a day, so the list does not reshuffle on refresh', () => {
    const shifts = [shift({ id: 'b' }), shift({ id: 'a' })];
    expect(buildAgenda([], shifts).map((e) => (e.kind === 'shift' ? e.shift.id : ''))).toEqual([
      'a',
      'b',
    ]);
    expect(buildAgenda([], [...shifts].reverse()).map((e) => (e.kind === 'shift' ? e.shift.id : ''))).toEqual([
      'a',
      'b',
    ]);
  });

  describe('shiftDays', () => {
    it('collects the days that carry a shift, once each', () => {
      const days = shiftDays([
        shift({ id: 'a', day: '2026-09-03' }),
        shift({ id: 'b', day: '2026-09-03' }),
        shift({ id: 'c', day: '2026-09-04' }),
      ]);
      expect([...days].sort()).toEqual(['2026-09-03', '2026-09-04']);
    });

    it('applies the same status and day rules as the list', () => {
      // Otherwise the grid dots and the list below them disagree about what
      // is on a day, which reads as a bug in whichever the user checks second.
      expect(shiftDays([shift({ status: 'REASSIGNED' })]).size).toBe(0);
      expect(shiftDays([shift({ day: undefined, work_request: undefined })]).size).toBe(0);
    });
  });
});

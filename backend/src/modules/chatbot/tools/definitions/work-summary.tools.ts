import { z } from 'zod';
import { plausibleDate } from '../schema-primitives.js';
import { assignmentService } from '../../../assignments/service.js';
import { attendanceService } from '../../../attendance/service.js';
import { roomService } from '../../../rooms/service.js';
import { refuseUnresolvedHotel, resolveHotelReference } from '../worker-reference.js';
import { toServiceActor } from '../actor.js';
import { registerTool, type CompactResult } from '../registry.js';
import { asRefusal } from '../tool-errors.js';
import { APPROVED_2026_09_15_FIELD_REPORT } from '../approvals.js';
import { todayIso } from './daily-operations.tools.js';

/**
 * "HOW MUCH WORK DID WE DO" -- one answer, not a choice of four datasets.
 *
 * Reported 2026-09-15:
 *
 *     > give me record data previews weeks how much work we did
 *     ... I can get the team data for assignments, attendance, absences, or
 *     rooms cleaned. Would you like a summary of one of these datasets ...
 *     > 07.09.2026 data
 *     From 2026-09-07, there is no recorded work data available — the count is 0.
 *
 * Two defects in one exchange. The manager asked a single question and was
 * handed a menu, because `reports.query_team` answers one dataset at a time.
 * And the 0 was very likely FALSE: that tool's `rooms` dataset is read through
 * `roomService.listMyRooms`, which is the CALLER's own room log -- for a
 * manager, who logs no rooms, it is always empty. A manager reading "0" reads
 * "nobody worked", not "you asked about your own rooms".
 *
 * So this reads the TEAM's shifts, clock-ins and room logs together and
 * answers with the totals. Every number comes from the owning module's own
 * scoped list, called with the caller as the actor -- the same reads the
 * calendar, the attendance screen and the manager's live room view make, so it
 * can never show more than those screens would.
 *
 * ROOMS ARE THE WORKERS' OWN LOGS, counted per day through
 * `listRoomsForHotels` -- the read that replaced the manual rooms-completed
 * count. That read is one day at a time, so rooms are counted for ranges of up
 * to 31 days and the summary says so beyond that rather than showing a partial
 * number as a total.
 */

const MAX_DAYS = 92;
const ROOM_LOG_MAX_DAYS = 31;
/** Rows per module before the summary says it is incomplete. */
const ROW_CAP = 5_000;

const dayCount = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

/**
 * THE RANGE IS OPTIONAL, defaulting to the last two weeks up to today.
 *
 * The live routing check of 2026-09-15 put the owner's own sentence to the
 * model -- "give me record data previews weeks how much work we did" -- and it
 * called NO tool, twice: "previews weeks" names no dates, both dates were
 * required, so the model wrote a question instead of acting. A manager asking
 * how much work was done recently wants recent work, and two weeks is the
 * reading a person would give it. The summary states the dates it used, so a
 * different intent is one short correction away. One date alone means that
 * single day.
 */
const DEFAULT_DAYS = 14;

const WorkSummaryArgs = z
  .object({
    from: plausibleDate.optional(),
    to: plausibleDate.optional(),
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict()
  .refine((a) => !a.from || !a.to || a.from <= a.to, { message: 'from must not be after to', path: ['from'] })
  .refine((a) => !a.from || !a.to || dayCount(a.from, a.to) <= MAX_DAYS, {
    message: `the range can be at most ${MAX_DAYS} days`,
    path: ['to'],
  });

type WorkSummaryArgs = z.infer<typeof WorkSummaryArgs>;

function resolveRange(args: WorkSummaryArgs): { from: string; to: string } {
  if (args.from && args.to) return { from: args.from, to: args.to };
  if (args.from || args.to) {
    const day = (args.from ?? args.to)!;
    return { from: day, to: day };
  }
  const to = todayIso();
  const from = new Date(Date.parse(`${to}T12:00:00Z`) - (DEFAULT_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

async function readAll<T>(
  fetch: (page: number) => Promise<{ data: T[]; total: number }>
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let page = 1; page <= 60; page += 1) {
    const { data } = await fetch(page);
    rows.push(...data);
    if (data.length < 100) return { rows, truncated: false };
    if (rows.length >= ROW_CAP) return { rows, truncated: true };
  }
  return { rows, truncated: true };
}

interface WorkSummary {
  from: string;
  to: string;
  hotel: string | null;
  shifts: number;
  finished: number;
  cancelled: number;
  people: number;
  hours: number;
  late: number;
  absent: number;
  rooms: number | null;
  truncated: boolean;
}

export const teamWorkSummary = registerTool<WorkSummaryArgs>({
  name: 'reports.work_summary',
  description:
    "Summarises how much work the caller's TEAM did over a date range, in one answer: shifts " +
    'planned, finished and cancelled, how many people worked, hours clocked, late arrivals, ' +
    'no-shows and rooms logged. Use when a manager asks how much work was done: "how much work ' +
    'did we do last week", "give me the data for 07.09.2026", "wie viel haben wir im August ' +
    'geschafft". Dates are YYYY-MM-DD, at most 92 days apart; leave them out for the last two weeks, ' +
    'and add hotel_name to narrow it to one ' +
    'hotel. Returns the totals as numbers. For the individual rows use reports.query_team, and ' +
    'for a file use reports.export_team.',
  tier: 'READ_ONLY',
  confirm: false,
  // Exact counts and the dates they cover, as computed. The live run of
  // 2026-09-15 got them back reworded, with the dates in another format.
  finalAnswer: true,

  interfaceRef:
    'IF-ASG-ListAssignments + IF-ATT-ListAttendance + IF-ROOM-ListRoomsForHotels (each with the caller as actor)',
  approvalRef:
    APPROVED_2026_09_15_FIELD_REPORT +
    " Registration note: team totals over at most 92 days, read through each owning module's own scoped list.",

  args: WorkSummaryArgs,
  permission: 'reports:read-team',
  scopeCheck: 'none',

  invoke: async (rawArgs, actor) => {
    const serviceActor = toServiceActor(actor);
    const args = { ...rawArgs, ...resolveRange(rawArgs) };

    // A hotel only when one was named. Without a name the owning modules
    // already narrow to the caller's scope, which is "all of my hotels" --
    // exactly what "how much did WE do" means to a regional manager.
    let hotel: { hotelId: string; name: string } | null = null;
    if (args.hotel_name) {
      const resolved = await resolveHotelReference(args.hotel_name, actor);
      if (resolved.status !== 'RESOLVED') return refuseUnresolvedHotel(resolved);
      hotel = { hotelId: resolved.hotelId, name: resolved.name };
    }
    const hotelFilter = hotel ? { hotel_id: hotel.hotelId } : {};

    const [assignments, attendance] = await Promise.all([
      readAll((page) =>
        assignmentService.list(
          { from: args.from, to: args.to, ...hotelFilter, page, per_page: 100 } as never,
          serviceActor
        ) as Promise<{ data: Array<{ status: string; worker_id: string }>; total: number }>
      ),
      readAll((page) =>
        attendanceService.list(
          { from: args.from, to: args.to, ...hotelFilter, page, per_page: 100 } as never,
          serviceActor
        ) as Promise<{
          data: Array<{ status: string; minutes_worked: number | null; minutes_late: number | null }>;
          total: number;
        }>
      ),
    ]);

    let rooms: number | null = null;
    const days = dayCount(args.from, args.to);
    if (days <= ROOM_LOG_MAX_DAYS) {
      rooms = 0;
      for (let i = 0; i < days; i += 1) {
        const day = new Date(Date.parse(`${args.from}T12:00:00Z`) + i * 86_400_000)
          .toISOString()
          .slice(0, 10);
        // COUNTED BY THE ROOM'S OWN DAY, not by `by_worker`. The room reads
        // deliberately span the target day AND the day before it, so a night
        // shift's rooms logged after midnight stay visible (rooms/service.ts,
        // `dayRangeFrom`). Summing `by_worker` across consecutive days
        // therefore counted every room twice -- found by the data-layer run of
        // 2026-09-15, which seeded eight rooms and was told sixteen.
        const { rooms: logged } = await roomService.listRoomsForHotels(serviceActor as never, {
          day,
          ...hotelFilter,
        });
        rooms += logged.filter((room) => String(room.day).slice(0, 10) === day).length;
      }
    }

    const live = assignments.rows.filter((a) => a.status !== 'CANCELLED' && a.status !== 'REASSIGNED');
    const minutes = attendance.rows.reduce((sum, a) => sum + (a.minutes_worked ?? 0), 0);

    const summary: WorkSummary = {
      from: args.from,
      to: args.to,
      hotel: hotel?.name ?? null,
      shifts: live.length,
      finished: assignments.rows.filter((a) => a.status === 'COMPLETED').length,
      cancelled: assignments.rows.filter((a) => a.status === 'CANCELLED').length,
      people: new Set(live.map((a) => a.worker_id)).size,
      hours: Math.round((minutes / 60) * 10) / 10,
      late: attendance.rows.filter((a) => a.status === 'LATE' || (a.minutes_late ?? 0) > 0).length,
      absent: attendance.rows.filter((a) => a.status === 'ABSENT').length,
      rooms,
      truncated: assignments.truncated || attendance.truncated,
    };
    return summary;
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };

    const s = raw as WorkSummary | null;
    if (!s) return { summary: 'No data.', data: null };

    const period = s.from === s.to ? `On ${s.from}` : `From ${s.from} to ${s.to}`;
    const where = s.hotel ? ` at ${s.hotel}` : ' across your hotels';
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

    // A TRUE ZERO, said as one. "The count is 0" left a manager unsure whether
    // nobody worked or the question was wrong; this names what was checked.
    if (s.shifts === 0 && s.cancelled === 0 && s.hours === 0 && !s.rooms) {
      return {
        summary: `${period}${where} there is no work recorded: no shifts on the calendar, nobody clocked in, and no rooms logged.`,
        data: s,
      };
    }

    const parts = [
      `${plural(s.shifts, 'shift')} (${s.finished} finished${s.cancelled ? `, ${s.cancelled} cancelled` : ''}) worked by ${plural(s.people, 'person').replace('persons', 'people')}`,
      `${s.hours} hours clocked`,
      ...(s.late ? [plural(s.late, 'late arrival')] : []),
      ...(s.absent ? [plural(s.absent, 'no-show')] : []),
      s.rooms === null ? 'rooms are counted for ranges of up to 31 days' : `${plural(s.rooms, 'room')} logged`,
    ];

    return {
      summary:
        `${period}${where}: ${parts.join(', ')}.` +
        (s.truncated ? ' This is a very large range, so the totals are incomplete -- narrow it for exact numbers.' : ''),
      data: s,
    };
  },
  maxResultTokens: 200,
});

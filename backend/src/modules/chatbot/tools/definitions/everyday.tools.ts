import { z } from 'zod';
import { isoDate } from '../schema-primitives.js';
import { roomService } from '../../../rooms/service.js';
import { calendarService } from '../../../calendar/service.js';
import { jobRequestService } from '../../../job-requests/service.js';
import {
  refuseUnresolved,
  refuseUnresolvedHotel,
  resolveHotelReference,
  resolveWorkerReference,
} from '../worker-reference.js';
import { toServiceActor } from '../actor.js';
import type { ActorContext } from '../actor.js';
import { registerTool, type CompactResult } from '../registry.js';
import { asRefusal, refuse } from '../tool-errors.js';
import { APPROVED_2026_09_15_EVERYDAY } from '../approvals.js';
import { todayIso } from './daily-operations.tools.js';

/**
 * EVERYDAY GAPS, found by mapping every platform route against the registry
 * on 2026-09-15 and keeping only what people do daily and could not do here:
 *
 *   - a worker who logged the wrong room number could log a room but never
 *     fix or remove one -- the routes existed, the tool did not;
 *   - a manager could not see who has logged how many rooms today, the
 *     live view the web app has had since the room log replaced manual counts;
 *   - a manager could record a worker's sick day but not withdraw it when the
 *     worker turned out to be fine;
 *   - a manager could raise a staffing request here but neither list nor
 *     cancel the ones already raised.
 *
 * Each wraps the route's own service method with the actor from req.auth.
 * NOT built, deliberately: changing your own phone number or language.
 * `PUT /auth/profile` enforces no permission token, and a write tool needs a
 * real one; minting one is a permission change, which the owner reserved.
 */

const sameRoom = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/* ------------------------------------------------------------------ *
 * rooms.fix_my_room  (worker)
 * ------------------------------------------------------------------ */

const FixRoomArgs = z
  .object({
    room_number: z.string().trim().min(1).max(20),
    /** Absent means remove the entry. */
    new_room_number: z.string().trim().min(1).max(20).optional(),
    day: isoDate.optional(),
  })
  .strict()
  .refine((a) => !a.new_room_number || !sameRoom(a.room_number, a.new_room_number), {
    message: 'the new room number is the same as the old one',
    path: ['new_room_number'],
  });

type FixRoomArgs = z.infer<typeof FixRoomArgs>;

async function findMyRoom(args: FixRoomArgs, actor: ActorContext) {
  const day = args.day ?? todayIso();
  const { rooms } = await roomService.listMyRooms(toServiceActor(actor) as never, day);
  // The read spans the day before as well (night shifts), so the day is
  // matched here -- "room 214" yesterday is not the "room 214" meant today.
  const match = (rooms as Array<{ id: string; day: string; room_number: string; editable: boolean }>).find(
    (r) => String(r.day).slice(0, 10) === day && sameRoom(r.room_number, args.room_number)
  );
  if (!match) return refuse('NOT_FOUND', `You have not logged room ${args.room_number} on ${day}.`);
  // The service refuses too; saying so before a confirmation saves a wasted "yes".
  if (!match.editable) {
    return refuse('ALREADY_DONE', `Room ${match.room_number} has already been checked, so it can no longer be changed.`);
  }
  return { id: match.id, room: match.room_number, day };
}

export const fixMyRoom = registerTool<FixRoomArgs>({
  name: 'rooms.fix_my_room',
  description:
    "Changes or removes a room the worker logged by mistake in their OWN room log. Use when a " +
    'worker got a room number wrong: "I logged 214 but it was 241", "remove room 118, I did ' +
    'not clean it", "Zimmer 305 war falsch, es war 350". Give the room number as logged, and the ' +
    'correct number if it should be changed rather than removed; add the day as YYYY-MM-DD only ' +
    'if it was not today. Returns what the log now says. A room already inspected cannot be changed.',
  tier: 'LOW_RISK_WRITE',
  // Confirmed: removing a room lowers the worker's own count, and a misheard
  // number would edit the wrong entry.
  confirm: true,

  interfaceRef: 'IF-ROOM-UpdateRoom / IF-ROOM-DeleteRoom (rooms/service.ts updateRoom(), deleteRoom())',
  approvalRef:
    APPROVED_2026_09_15_EVERYDAY +
    " Registration note: self-scoped; only the caller's own uninspected room log entries, by room number.",

  args: FixRoomArgs,
  // The token PUT and DELETE /rooms/logs/:id enforce. The service refuses any
  // entry that is not the caller's own, so a manager holding the token
  // reaches nothing.
  permission: 'rooms:write',
  scopeCheck: 'self',

  precheck: async (args, actor) => {
    const found = await findMyRoom(args, actor);
    return 'refused' in found ? found : null;
  },

  invoke: async (args, actor) => {
    const found = await findMyRoom(args, actor);
    if ('refused' in found) return found;
    const serviceActor = toServiceActor(actor) as never;

    try {
      if (args.new_room_number) {
        await roomService.updateRoom(found.id, args.new_room_number, serviceActor);
        return { day: found.day, from: found.room, to: args.new_room_number.trim() };
      }
      await roomService.deleteRoom(found.id, serviceActor);
      return { day: found.day, removed: found.room };
    } catch (error) {
      // "Room 241 was already logged today" is the state of the log, not a
      // failure to retry.
      const message = error instanceof Error ? error.message : String(error);
      if (/already/i.test(message)) return refuse('ALREADY_DONE', message);
      throw error;
    }
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    const r = raw as { day?: string; from?: string; to?: string; removed?: string } | null;
    if (!r) return { summary: 'Nothing was changed.', data: null };
    return r.removed
      ? { summary: `Removed room ${r.removed} from your log for ${r.day}.`, data: { removed: r.removed, day: r.day } }
      : { summary: `Room ${r.from} is now room ${r.to} in your log for ${r.day}.`, data: { from: r.from, to: r.to, day: r.day } };
  },
  maxResultTokens: 80,
});

/* ------------------------------------------------------------------ *
 * rooms.team_today  (manager)
 * ------------------------------------------------------------------ */

const TeamRoomsArgs = z
  .object({
    day: isoDate.optional(),
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

type TeamRoomsArgs = z.infer<typeof TeamRoomsArgs>;

export const teamRoomsToday = registerTool<TeamRoomsArgs>({
  name: 'rooms.team_today',
  description:
    "Lists how many rooms each worker on the manager's TEAM has logged on a day, today unless " +
    'said otherwise. Use for "how many rooms has everyone done today", "who has cleaned what so ' +
    'far", "wie viele Zimmer hat jeder heute geschafft". Give the day as YYYY-MM-DD if it is not ' +
    'today, and hotel_name to narrow it to one hotel. Returns each worker with their count and ' +
    "the total. For the manager's own rooms use rooms.my_rooms; for totals over a range use " +
    'reports.work_summary.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-ROOM-ListRoomsForHotels (rooms/service.ts listRoomsForHotels())',
  approvalRef:
    APPROVED_2026_09_15_EVERYDAY +
    " Registration note: the manager's live room view, per worker, for one day, within the caller's own hotels.",

  args: TeamRoomsArgs,
  // `rooms:read` is the token GET /rooms/for-hotels enforces; `staffing:read`
  // carries the route's role gate (manager, RM, admin), because `rooms:read`
  // alone is also held by every worker and the route admits no worker.
  permission: ['rooms:read', 'staffing:read'],
  scopeCheck: 'none',

  invoke: async (args, actor) => {
    const day = args.day ?? todayIso();
    let hotel: { hotelId: string; name: string } | null = null;
    if (args.hotel_name) {
      const resolved = await resolveHotelReference(args.hotel_name, actor);
      if (resolved.status !== 'RESOLVED') return refuseUnresolvedHotel(resolved);
      hotel = { hotelId: resolved.hotelId, name: resolved.name };
    }

    const { rooms } = await roomService.listRoomsForHotels(toServiceActor(actor) as never, {
      day,
      ...(hotel ? { hotel_id: hotel.hotelId } : {}),
    });

    // Counted by the room's own day -- the read includes the day before
    // (see work-summary.tools.ts, where summing it double-counted).
    const counts = new Map<string, number>();
    for (const room of rooms as Array<{ day: string; worker_name: string | null }>) {
      if (String(room.day).slice(0, 10) !== day) continue;
      const name = room.worker_name ?? 'Unknown worker';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const workers = [...counts.entries()]
      .map(([worker, rooms]) => ({ worker, rooms }))
      .sort((a, b) => b.rooms - a.rooms || a.worker.localeCompare(b.worker));

    return { day, hotel: hotel?.name ?? null, workers };
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    const r = raw as { day: string; hotel: string | null; workers: Array<{ worker: string; rooms: number }> };
    const when = r.day === todayIso() ? 'today' : `on ${r.day}`;
    const where = r.hotel ? ` at ${r.hotel}` : '';
    if (r.workers.length === 0) {
      return { summary: `No rooms have been logged ${when}${where} yet.`, data: { day: r.day, total: 0 } };
    }
    const total = r.workers.reduce((sum, w) => sum + w.rooms, 0);
    const shown = r.workers.slice(0, 25).map((w) => `${w.worker} ${w.rooms}`);
    return {
      summary: `Rooms logged ${when}${where}: ${shown.join(', ')} (${total} in total).`,
      data: { day: r.day, total, workers: r.workers.slice(0, 25) },
    };
  },
  maxResultTokens: 400,
});

/* ------------------------------------------------------------------ *
 * calendar.withdraw_worker_absence  (manager)
 * ------------------------------------------------------------------ */

const WithdrawWorkerAbsenceArgs = z
  .object({
    worker_name: z.string().trim().min(2).max(80),
    day: isoDate,
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

type WithdrawWorkerAbsenceArgs = z.infer<typeof WithdrawWorkerAbsenceArgs>;

async function findWorkerAbsence(args: WithdrawWorkerAbsenceArgs, actor: ActorContext) {
  const hotel = await resolveHotelReference(args.hotel_name, actor);
  if (hotel.status !== 'RESOLVED') return refuseUnresolvedHotel(hotel);
  const worker = await resolveWorkerReference(args.worker_name, actor, hotel.hotelId);
  if (worker.status !== 'RESOLVED') return refuseUnresolved(worker);

  if (args.day < todayIso()) {
    // The service refuses a past absence too: the day happened, and deleting
    // the record would rewrite history rather than change a plan.
    return refuse('ALREADY_DONE', `${args.day} has already passed, so ${worker.fullName}'s absence that day stays on record.`);
  }

  const raw = await calendarService.listAbsences(
    { from: args.day, to: args.day, worker_id: worker.workerId } as never,
    toServiceActor(actor)
  );
  const rows = (Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? [])) as Array<{
    id: string;
    worker_id: string;
    day: string;
    kind: string;
  }>;
  const match = rows.find((a) => a.worker_id === worker.workerId && String(a.day).slice(0, 10) === args.day);
  if (!match) return refuse('NOT_FOUND', `${worker.fullName} has no sick or holiday day recorded on ${args.day}.`);
  return { id: match.id, kind: match.kind, worker: worker.fullName, day: args.day };
}

export const withdrawWorkerAbsence = registerTool<WithdrawWorkerAbsenceArgs>({
  name: 'calendar.withdraw_worker_absence',
  description:
    "Withdraws a sick or holiday day recorded for one of the manager's OWN workers, when they " +
    'are not off after all. Use when told someone is back or will work: "Anna is better, she is ' +
    'not off tomorrow", "cancel Tomasz\'s holiday on Friday", "Maria ist doch nicht krank am ' +
    'Montag". Give the worker\'s name and the day as YYYY-MM-DD. Returns which day was cleared. ' +
    'It does not put them back on a shift -- use assignments.place_worker for that. For the ' +
    "manager's own day off use calendar.withdraw_my_absence.",
  // Clearing another person's recorded absence changes whether they are
  // expected at work, and it may be a day they declared themselves.
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-CAL-ListAbsences + IF-CAL-DeleteAbsence (calendar/service.ts listAbsences(), deleteAbsence())',
  approvalRef:
    APPROVED_2026_09_15_EVERYDAY +
    " Registration note: removes one in-scope worker's future absence on a named day; deleteAbsence re-checks group scope.",

  args: WithdrawWorkerAbsenceArgs,
  // The team-absence capability, held by admin, manager and RM only -- the
  // same token calendar.mark_worker_absence declares for the opposite act.
  // DELETE /calendar/absences/:id carries no token of its own (it also serves
  // a worker's self-withdrawal); the service's group-scope check is the gate.
  permission: 'calendar:absence:write-team',
  scopeCheck: 'none',

  precheck: async (args, actor) => {
    const found = await findWorkerAbsence(args, actor);
    return 'refused' in found ? found : null;
  },

  invoke: async (args, actor) => {
    const found = await findWorkerAbsence(args, actor);
    if ('refused' in found) return found;
    await calendarService.deleteAbsence(found.id, toServiceActor(actor));
    return { worker: found.worker, day: found.day, kind: found.kind };
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    const r = raw as { worker?: string; day?: string; kind?: string } | null;
    if (!r) return { summary: 'Nothing was changed.', data: null };
    const what = r.kind === 'VACATION' ? 'holiday' : 'sick day';
    return {
      // Said explicitly: a sick day auto-cancelled their shift, and withdrawing
      // it does not bring the shift back. A manager assuming it did would find
      // out the morning nobody came.
      summary: `${r.worker}'s ${what} on ${r.day} is withdrawn. Any shift it cancelled is not restored -- put them back on the schedule if they should work.`,
      data: { worker: r.worker, day: r.day },
    };
  },
  maxResultTokens: 100,
});

/* ------------------------------------------------------------------ *
 * job_requests.list_for_my_team / job_requests.cancel_request  (manager)
 * ------------------------------------------------------------------ */

const LIVE_REQUEST_STATUSES = ['DRAFT', 'OPEN', 'PARTIALLY_FILLED'];

interface RequestRow {
  id: string;
  position: string;
  workers_needed: number;
  shift_date: string;
  shift_start_time?: string | null;
  shift_end_time?: string | null;
  status: string;
  hotel?: { name?: string } | null;
  hotel_name?: string | null;
}

const describeRequest = (r: RequestRow, fallbackHotel?: string | null) => {
  const hotel = r.hotel?.name ?? r.hotel_name ?? fallbackHotel ?? null;
  const times = r.shift_start_time && r.shift_end_time ? ` ${r.shift_start_time}-${r.shift_end_time}` : '';
  return `${r.shift_date}${times}${hotel ? ` at ${hotel}` : ''}: ${r.workers_needed} x ${r.position} (${String(r.status).toLowerCase().replace('_', ' ')})`;
};

async function listLiveRequests(
  filter: { day?: string; hotel_name?: string },
  actor: ActorContext
): Promise<{ rows: RequestRow[]; hotel: string | null } | { refused: unknown }> {
  let hotel: { hotelId: string; name: string } | null = null;
  if (filter.hotel_name) {
    const resolved = await resolveHotelReference(filter.hotel_name, actor);
    if (resolved.status !== 'RESOLVED') return refuseUnresolvedHotel(resolved);
    hotel = { hotelId: resolved.hotelId, name: resolved.name };
  }
  const { data } = await jobRequestService.list(
    {
      status: LIVE_REQUEST_STATUSES,
      ...(filter.day ? { shift_date: filter.day } : {}),
      ...(hotel ? { hotel_id: hotel.hotelId } : {}),
      page: 1,
      per_page: 50,
    } as never,
    toServiceActor(actor)
  );
  // Past requests are history, not something to manage.
  const today = todayIso();
  const rows = ((data ?? []) as RequestRow[])
    .filter((r) => LIVE_REQUEST_STATUSES.includes(String(r.status)) && String(r.shift_date) >= today)
    // Day, then start time: the data-layer run listed an 18:00 request above a
    // 07:00 one on the same day, which is not how anyone reads a rota.
    .sort(
      (a, b) =>
        String(a.shift_date).localeCompare(String(b.shift_date)) ||
        String(a.shift_start_time ?? '').localeCompare(String(b.shift_start_time ?? ''))
    );
  return { rows, hotel: hotel?.name ?? null };
}

const ListRequestsArgs = z
  .object({
    day: isoDate.optional(),
    hotel_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

type ListRequestsArgs = z.infer<typeof ListRequestsArgs>;

export const listTeamRequests = registerTool<ListRequestsArgs>({
  name: 'job_requests.list_for_my_team',
  description:
    "Lists the staffing requests the manager's hotels still have open -- shifts asked for and " +
    'not yet filled or cancelled. Use for "what staffing requests are open", "which shifts still ' +
    'need people", "welche Anfragen sind noch offen". Give a day as YYYY-MM-DD to narrow it, and ' +
    'hotel_name for one hotel. Returns each request\'s day, times, headcount, position and ' +
    'status. To raise a new one use job_requests.create_broadcast; a worker looking for extra ' +
    'shifts uses job_requests.list_open.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-JOB-ListWorkRequests (job-requests/service.ts list())',
  approvalRef:
    APPROVED_2026_09_15_EVERYDAY +
    " Registration note: live, current-or-future requests within the caller's own hotels.",

  args: ListRequestsArgs,
  // GET /job-requests carries no token (workers read it too, narrowed by the
  // service); this is the MANAGEMENT view, so it declares the staffing read
  // token held only by admin, manager and RM, keeping it out of a worker's
  // manifest beside job_requests.list_open.
  permission: 'staffing:read',
  scopeCheck: 'none',

  invoke: async (args, actor) => listLiveRequests(args, actor),

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    const r = raw as { rows: RequestRow[]; hotel: string | null };
    if (r.rows.length === 0) {
      return { summary: `There are no open staffing requests${r.hotel ? ` at ${r.hotel}` : ''}.`, data: { count: 0 } };
    }
    const lines = r.rows.slice(0, 15).map((row) => describeRequest(row, r.hotel));
    return {
      summary: `${r.rows.length} open staffing request${r.rows.length === 1 ? '' : 's'}:\n${lines.map((l) => `• ${l}`).join('\n')}`,
      // No request ids: cancel_request finds a request by day and position.
      data: { count: r.rows.length, requests: lines },
    };
  },
  maxResultTokens: 500,
});

const CancelRequestArgs = z
  .object({
    shift_date: isoDate,
    position: z.string().trim().min(1).max(120).optional(),
    hotel_name: z.string().trim().min(2).max(120).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

type CancelRequestArgs = z.infer<typeof CancelRequestArgs>;

async function findRequestToCancel(args: CancelRequestArgs, actor: ActorContext) {
  const listed = await listLiveRequests({ day: args.shift_date, hotel_name: args.hotel_name }, actor);
  if ('refused' in listed) return listed;
  const wanted = args.position?.trim().toLowerCase();
  const matches = listed.rows.filter((r) => !wanted || r.position.toLowerCase().includes(wanted));
  if (matches.length === 0) {
    return refuse(
      'NOT_FOUND',
      `There is no open staffing request${args.position ? ` for ${args.position}` : ''} on ${args.shift_date}.`
    );
  }
  if (matches.length > 1) {
    // Choosing one would cancel a request nobody named -- and cancelling
    // un-books whoever already took it.
    return refuse(
      'AMBIGUOUS',
      `There are ${matches.length} open requests on ${args.shift_date}: ${matches.map((m) => describeRequest(m, listed.hotel)).join('; ')}. Say which position.`
    );
  }
  return { row: matches[0]!, hotel: listed.hotel };
}

export const cancelTeamRequest = registerTool<CancelRequestArgs>({
  name: 'job_requests.cancel_request',
  description:
    "Cancels one of the manager's open staffing requests, so workers can no longer take it. Use " +
    'when a shift asked for is no longer needed: "cancel the cleaner request for Friday", "we do ' +
    'not need the extra housekeepers on 2026-09-20 any more", "Anfrage für Samstag stornieren". ' +
    'Give the shift date as YYYY-MM-DD, and the position when more than one request falls on that ' +
    'day. Returns which request was cancelled. Anyone who had already taken it is no longer booked.',
  // It cascades: every assignment already accepted from the request is
  // cancelled with it (job-requests/service.ts update()). Other people's
  // shifts disappear, so the manager sees the exact request first.
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-JOB-UpdateWorkRequest (job-requests/service.ts update(), status CANCELLED)',
  approvalRef:
    APPROVED_2026_09_15_EVERYDAY +
    " Registration note: cancels one live, in-scope request identified by day and position; refuses when several match.",

  args: CancelRequestArgs,
  // The token PATCH /job-requests/:id enforces.
  permission: 'staffing:write',
  scopeCheck: 'none',

  precheck: async (args, actor) => {
    const found = await findRequestToCancel(args, actor);
    return 'refused' in found ? found : null;
  },

  invoke: async (args, actor) => {
    const found = await findRequestToCancel(args, actor);
    if ('refused' in found) return found;
    await jobRequestService.update(
      found.row.id,
      { status: 'CANCELLED', cancellation_reason: args.reason ?? 'Cancelled by a manager through Zelle' } as never,
      toServiceActor(actor) as never
    );
    return { request: describeRequest({ ...found.row, status: 'CANCELLED' }, found.hotel) };
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    const r = raw as { request?: string } | null;
    if (!r) return { summary: 'Nothing was cancelled.', data: null };
    return {
      summary: `Cancelled the staffing request ${r.request}. Anyone who had taken it is no longer booked.`,
      data: { request: r.request },
    };
  },
  maxResultTokens: 120,
});

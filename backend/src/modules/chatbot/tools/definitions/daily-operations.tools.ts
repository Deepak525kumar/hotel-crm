import { z } from 'zod';
import { isoDate } from '../schema-primitives.js';
import { assignmentService } from '../../../assignments/service.js';
import { attendanceService } from '../../../attendance/service.js';
import { roomService } from '../../../rooms/service.js';
import { toServiceActor } from '../actor.js';
import { registerTool, type CompactResult } from '../registry.js';

/**
 * The commissioning human's approval of the seven tools added after the
 * 2026-09-08 batch, granted the same day under `ADR-053` item 4 and recorded
 * separately because it is a separate decision about a separate set.
 *
 * Granted after a LIVE routing test against the real model rather than on the
 * code alone: 32 realistic phrases in English and German, covering tool
 * selection, argument extraction, permission filtering and prompt injection.
 * All 32 routed correctly -- including a worker asking to "export the whole
 * team attendance", which selected no tool at all because the manifest is
 * filtered by permission before the model ever sees it.
 *
 * Same scope limit as the first approval: it covers these tools AS REGISTERED
 * on this date. Widening a tool's scope, risk tier or permission makes it a
 * different capability and returns it to PENDING.
 */
const APPROVED_2026_09_08_SHIFT_AND_REPORTS =
  'APPROVED 2026-09-08 by the commissioning human under ADR-053 item 4, after a ' +
  'live routing test against the real model (32/32 phrases routed correctly). ' +
  'Covers this tool as registered on that date; a later change to its scope, ' +
  'risk tier or permission requires re-approval.';
import type { ActorContext } from '../actor.js';

/**
 * THE WORKER'S OWN SHIFT — clocking in and out, and logging the rooms they
 * cleaned.
 *
 * WHY THESE, AND WHY IN THEIR OWN FILE. The thirteen tools approved on
 * 2026-09-08 answered questions and let a MANAGER plan a week. They did not
 * cover the things a worker does on every single shift: starting it, finishing
 * it, and recording the work. A worker could ask the assistant what their
 * shift was, but not tell it they had begun.
 *
 * That population is also the one a conversational interface serves best. A
 * housekeeper mid-shift has a phone in one hand and a trolley in the other,
 * often works in a second language, and is the least likely person on the
 * platform to navigate a form. `self-service.tools.ts` had also passed 1,500
 * lines and produced two append-on-append merge conflicts that silently
 * corrupted the file; a second file is the boring fix for both problems.
 *
 * NO IDENTIFIER IS EVER AN ARGUMENT HERE, and that is a stronger claim than
 * FORBIDDEN_ARG_KEYS makes on its own. `assignment_id` is not on that list --
 * it is not an authorization input in the way `worker_id` is -- but a model
 * emitting one would still be guessing at which shift a person meant. So the
 * shift is RESOLVED from the actor's own roster instead: `resolveMyShift()`
 * asks the owning service for the caller's assignments and picks out the one
 * for the day in question. A person says "I'm starting"; the platform decides
 * what that refers to.
 *
 * EVERY ONE OF THESE IS SELF-SCOPED BY IDENTITY IN THE OWNING SERVICE, not by
 * the tool and not by the model:
 *   - `checkIn()` refuses any assignment whose `worker_id` is not the caller.
 *   - `logRoom()` applies the same rule to EVERY role including admin, because
 *     an admin logging rooms as a worker would falsify that worker's own
 *     accountability record.
 *   - `update()` on attendance routes a self-scoped caller to a branch that
 *     may set only `check_out_at` and `notes`, on their own row.
 *
 * THE GEOFENCE IS NOT BYPASSED BY GOING THROUGH THE ASSISTANT, which was the
 * first thing worth checking before building any of this. `checkIn()` decides
 * whether location is required from the HOTEL'S configuration, never from
 * whether the client happened to send coordinates -- so a check-in carrying no
 * coordinates at a geofenced hotel is REFUSED, not quietly allowed. A chatbot
 * has no GPS, so at those hotels these tools correctly cannot clock anyone in,
 * and the refusal is surfaced as a plain instruction to use the app rather
 * than as a failed turn.
 */

/** What the owning service returns for one assignment, narrowed to what is used. */
interface ShiftLike {
  id: string;
  day?: string;
  status?: string;
  hotel_id?: string;
  hotel?: { name?: string } | null;
}

type ShiftResolution =
  | { status: 'RESOLVED'; shift: ShiftLike }
  | { status: 'NONE'; day: string }
  | { status: 'AMBIGUOUS'; day: string; count: number };

/** Today, in the platform's calendar convention (YYYY-MM-DD). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The caller's own shift for a day, resolved rather than named.
 *
 * Returns a RESULT rather than throwing for the two ordinary outcomes -- no
 * shift, or more than one -- because both are things a person can act on
 * ("you're not scheduled today") and an exception would turn them into a
 * failed turn carrying no useful guidance.
 *
 * AMBIGUITY IS REFUSED, NOT GUESSED. Two assignments on one day is rare but
 * real (a split shift, or a rework assignment alongside the original), and
 * picking one would clock somebody into a shift they did not mean. The refusal
 * names the count so the person knows why.
 */
export async function resolveMyShift(
  actor: ActorContext,
  day: string
): Promise<ShiftResolution> {
  const serviceActor = toServiceActor(actor);

  // The service narrows to the caller's own rows for any self-scoped role --
  // this tool never passes a worker id, and could not: it is a forbidden key.
  const { data } = await assignmentService.list(
    { page: 1, per_page: 50 } as Parameters<typeof assignmentService.list>[0],
    serviceActor
  );

  const onDay = (data as ShiftLike[]).filter(
    (a) => String(a.day ?? '').slice(0, 10) === day && a.status !== 'CANCELLED'
  );

  if (onDay.length === 0) return { status: 'NONE', day };
  if (onDay.length > 1) return { status: 'AMBIGUOUS', day, count: onDay.length };
  return { status: 'RESOLVED', shift: onDay[0] };
}

/** A refusal a person can act on, in their own terms. */
export function describeUnresolvedShift(result: ShiftResolution): string {
  if (result.status === 'NONE') {
    return `You have no shift scheduled for ${result.day}.`;
  }
  if (result.status === 'AMBIGUOUS') {
    return (
      `You have ${result.count} shifts on ${result.day}, so I cannot tell which one you mean. ` +
      'Please use the app for this one.'
    );
  }
  return 'Could not identify your shift.';
}

/**
 * Turns an owning-service refusal into something a person can act on.
 *
 * The messages that matter are already written by the services and are
 * genuinely good ("Check-in denied: too early. Check-in opens 2 hours before
 * the shift starts."), so they are passed through rather than replaced. The
 * geofence case is the exception: "Location permission is required to check in
 * at this hotel" is true but leaves someone stuck, since the assistant has no
 * location to offer. That one gains the next step.
 */
export function explainWriteFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/location permission is required/i.test(message)) {
    return (
      'This hotel requires your location to check in, and I cannot read it. ' +
      'Please check in from the app instead.'
    );
  }
  if (/outside the hotel geofence/i.test(message)) {
    return 'You appear to be outside the hotel, so check-in was declined.';
  }
  return message;
}

// ---------------------------------------------------------------------------
// Clocking in and out
// ---------------------------------------------------------------------------

const CheckInArgs = z
  .object({
    // Optional and free text. `assignment_id` is deliberately absent: the
    // shift is resolved from the actor's own roster, never named by the model.
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

type CheckInArgs = z.infer<typeof CheckInArgs>;

export const checkInToMyShift = registerTool<CheckInArgs>({
  name: 'attendance.check_in',
  description:
    "Clock the authenticated user IN to their own shift for today. Use for \"I'm " +
    'starting work", "clock me in", "ich fange jetzt an", "I have arrived". Only ever ' +
    "acts on the caller's own shift, and only for today.",
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-ATT-CheckIn (attendance/service.ts checkIn())',
  approvalRef:
    APPROVED_2026_09_08_SHIFT_AND_REPORTS +
    ' Registration note: ' +
    'Writes a timestamped payroll record the worker cannot themselves retract, which is why it is HIGH_RISK. Refuses at a geofenced hotel, correctly -- a chatbot has no GPS.',

  args: CheckInArgs,
  permission: 'attendance:write-own',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    const day = todayIso();
    const resolved = await resolveMyShift(actor, day);
    if (resolved.status !== 'RESOLVED') {
      return { refused: describeUnresolvedShift(resolved) };
    }

    const serviceActor = toServiceActor(actor);
    try {
      const record = await attendanceService.checkIn(
        {
          assignment_id: resolved.shift.id,
          ...(args.notes ? { notes: args.notes } : {}),
          // No coordinates: a chatbot has none. checkIn() decides whether
          // location is REQUIRED from the hotel's own configuration, so a
          // geofenced hotel refuses this rather than letting it through.
        } as Parameters<typeof attendanceService.checkIn>[0],
        serviceActor.userId,
        serviceActor.role
      );
      return { checkedIn: true, at: record.check_in_at, status: record.status };
    } catch (error) {
      return { refused: explainWriteFailure(error) };
    }
  },

  compress: (raw: unknown): CompactResult => {
    const r = raw as { refused?: string; at?: string | null; status?: string } | null;
    if (!r) return { summary: 'Nothing was recorded.', data: null };
    if (r.refused) return { summary: r.refused, data: null };

    const time = r.at ? new Date(r.at).toISOString().slice(11, 16) : 'now';
    const late = r.status === 'LATE' ? ' You are marked late.' : '';
    return {
      summary: `Checked in at ${time}.${late}`,
      data: { checked_in_at: r.at, status: r.status },
    };
  },
  maxResultTokens: 80,
});

const CheckOutArgs = z
  .object({
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

type CheckOutArgs = z.infer<typeof CheckOutArgs>;

export const checkOutOfMyShift = registerTool<CheckOutArgs>({
  name: 'attendance.check_out',
  description:
    "Clock the authenticated user OUT of their own shift for today. Use for \"I'm " +
    'finished", "clock me out", "Feierabend", "I am done for today". Only ever acts on ' +
    "the caller's own shift.",
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef: 'IF-ATT-UpdateAttendance (attendance/service.ts update())',
  approvalRef:
    APPROVED_2026_09_08_SHIFT_AND_REPORTS +
    ' Registration note: ' +
    'Closes a payroll record with a timestamp the worker cannot themselves change afterwards.',

  args: CheckOutArgs,
  // The SELF token, even though PATCH /attendance/:id enforces none: this tool
  // reaches only the self branch of update(), and a manager's correction path
  // through the same route is a different capability that must not be implied.
  permission: 'attendance:write-own',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    const day = todayIso();
    const resolved = await resolveMyShift(actor, day);
    if (resolved.status !== 'RESOLVED') {
      return { refused: describeUnresolvedShift(resolved) };
    }

    const serviceActor = toServiceActor(actor);

    // The attendance row is found through the owning service, filtered by the
    // shift just resolved -- never by an id the model supplied. The service
    // narrows to the caller's own rows for a self-scoped role regardless.
    const { data } = await attendanceService.list(
      { assignment_id: resolved.shift.id, page: 1, per_page: 1 } as Parameters<
        typeof attendanceService.list
      >[0],
      serviceActor
    );

    const row = (data as Array<{ id: string; check_out_at?: string | null }>)[0];

    if (!row) {
      return { refused: 'You have not checked in to this shift yet.' };
    }
    if (row.check_out_at) {
      return { refused: 'You have already checked out of this shift.' };
    }

    try {
      const updated = await attendanceService.update(
        row.id,
        { check_out_at: new Date().toISOString(), ...(args.notes ? { notes: args.notes } : {}) },
        serviceActor.userId,
        serviceActor.role,
        serviceActor.scope ?? null
      );
      return { checkedOut: true, at: updated.check_out_at };
    } catch (error) {
      return { refused: explainWriteFailure(error) };
    }
  },

  compress: (raw: unknown): CompactResult => {
    const r = raw as { refused?: string; at?: string | null } | null;
    if (!r) return { summary: 'Nothing was recorded.', data: null };
    if (r.refused) return { summary: r.refused, data: null };
    const time = r.at ? new Date(r.at).toISOString().slice(11, 16) : 'now';
    return { summary: `Checked out at ${time}.`, data: { checked_out_at: r.at } };
  },
  maxResultTokens: 80,
});

// ---------------------------------------------------------------------------
// Logging the work
// ---------------------------------------------------------------------------

const LogRoomArgs = z
  .object({
    room_number: z.string().trim().min(1).max(20),
  })
  .strict();

type LogRoomArgs = z.infer<typeof LogRoomArgs>;

export const logRoomCleaned = registerTool<LogRoomArgs>({
  name: 'rooms.log_cleaned',
  description:
    'Record one room the authenticated user has just cleaned, on their own shift ' +
    'today. Use for "done with 214", "Zimmer 214 fertig", "I finished room 12". One ' +
    'room per call.',
  // LOW_RISK, and the only write here that is not confirmed. A worker logs
  // rooms many times a shift, and a confirmation on each would make the tool
  // slower than the app it exists to replace. It earns that: the worker can
  // correct or delete their own room log (rooms/service.ts updateRoom,
  // deleteRoom, both self-scoped), so a mistyped number is fixable by the
  // person who made it -- which is exactly the reversibility ADR-053 item 5
  // leaves to per-tool judgement at this tier.
  tier: 'LOW_RISK_WRITE',
  confirm: false,

  interfaceRef: 'IF-ROOM-LogRoom (rooms/service.ts logRoom())',
  approvalRef:
    APPROVED_2026_09_08_SHIFT_AND_REPORTS +
    ' Registration note: ' +
    'The one unconfirmed write: a worker logs rooms many times a shift, and can correct or delete their own log.',

  args: LogRoomArgs,
  permission: 'rooms:write',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    const day = todayIso();
    const resolved = await resolveMyShift(actor, day);
    if (resolved.status !== 'RESOLVED') {
      return { refused: describeUnresolvedShift(resolved) };
    }

    try {
      const log = await roomService.logRoom(
        resolved.shift.id,
        args.room_number,
        toServiceActor(actor) as Parameters<typeof roomService.logRoom>[2]
      );
      return { logged: true, room: log.room_number };
    } catch (error) {
      // Duplicate rooms, closed logging windows and rework assignments all
      // surface here with the owning service's own wording, which is better
      // than anything restated at this layer.
      return { refused: explainWriteFailure(error) };
    }
  },

  compress: (raw: unknown): CompactResult => {
    const r = raw as { refused?: string; room?: string } | null;
    if (!r) return { summary: 'Nothing was recorded.', data: null };
    if (r.refused) return { summary: r.refused, data: null };
    return { summary: `Room ${r.room} logged.`, data: { room: r.room } };
  },
  maxResultTokens: 60,
});

const MyRoomsArgs = z
  .object({
    day: isoDate.optional(),
  })
  .strict();

type MyRoomsArgs = z.infer<typeof MyRoomsArgs>;

export const listMyRoomsToday = registerTool<MyRoomsArgs>({
  name: 'rooms.my_rooms',
  description:
    'List the rooms the authenticated user has logged as cleaned, for today or a ' +
    'given day. Use for "how many rooms have I done", "which rooms did I log", ' +
    '"wie viele Zimmer habe ich geschafft". Defaults to today; give another day as ' +
    'YYYY-MM-DD. Returns the room numbers logged and reports any sent back for rework.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-ROOM-ListMyRooms (rooms/service.ts listMyRooms())',
  approvalRef:
    APPROVED_2026_09_08_SHIFT_AND_REPORTS +
    ' Registration note: ' +
    'Self-scoped + READ_ONLY.',

  args: MyRoomsArgs,
  permission: 'rooms:read',
  scopeCheck: 'self',

  invoke: async (args, actor) => {
    // listMyRooms filters on the actor's own worker_id internally; the day is
    // the only thing this tool supplies.
    return roomService.listMyRooms(
      toServiceActor(actor) as Parameters<typeof roomService.listMyRooms>[0],
      args.day
    );
  },

  compress: (raw: unknown): CompactResult => {
    const r = raw as {
      rooms?: Array<{ room_number?: string }>;
      needs_rework?: Array<{ room_number?: string }>;
    } | null;

    const rooms = r?.rooms ?? [];
    const rework = r?.needs_rework ?? [];

    if (rooms.length === 0 && rework.length === 0) {
      return { summary: 'You have not logged any rooms yet.', data: { count: 0 } };
    }

    const numbers = rooms.map((x) => x.room_number).filter(Boolean);
    const reworkNote =
      rework.length > 0
        ? ` ${rework.length} sent back for rework: ${rework
            .map((x) => x.room_number)
            .filter(Boolean)
            .join(', ')}.`
        : '';

    return {
      summary: `${rooms.length} room${rooms.length === 1 ? '' : 's'} logged: ${numbers.join(', ')}.${reworkNote}`,
      // Room numbers only -- no log ids, no assignment id, no worker id.
      data: { count: rooms.length, rooms: numbers, needs_rework: rework.length },
    };
  },
  maxResultTokens: 300,
});

import { z } from 'zod';
import { AssignmentStatus } from '@prisma/client';
import { isoDate } from '../schema-primitives.js';
import { assignmentService } from '../../../assignments/service.js';
import { roomService } from '../../../rooms/service.js';
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
import { APPROVED_2026_09_15_FIELD_REPORT } from '../approvals.js';
import { todayIso } from './daily-operations.tools.js';

/**
 * CHANGING A SHIFT THAT ALREADY EXISTS: cancelling it, and recording the rooms
 * cleaned on it.
 *
 * Both reported 2026-09-15 from real use.
 *
 *     > cancel shift for parveen kumar 16 September
 *     Sorry, I did not catch that.
 *
 * Parveen Kumar was on the calendar for the 16th -- the same conversation had
 * just placed her there -- and cancelling is something a manager does by hand
 * every week. The registry could place a shift and move one, and had nothing
 * that removed one, so the model reached for the nearest write and failed to
 * fill it in.
 *
 *     > parveen didi today 10 rooms
 *
 * The number a cleaning company is paid by, said the way it is said at a front
 * desk, with no tool to put it anywhere.
 *
 * BOTH FIND THE SHIFT THE SAME WAY, below, and both use it twice: once as the
 * confirmation precheck, so a manager is never asked to approve a call about a
 * shift that does not exist, and again at execution, because the rota may have
 * changed while the confirmation sat on screen.
 *
 * AUTHORIZATION. `staffing:write` is ADR-030 §3 C-24's token for managing
 * assignments -- held by admin, manager and regional manager, never by worker
 * or checker (checked against the real ROLE_PERMISSIONS). It is the token the
 * rooms-completed routes enforce, and the one `assignments.move_shift` already
 * declares for the same population. The owning service then applies its own
 * `isScopedManagerRole` + `isHotelInScope` check on every call here, exactly as
 * the HTTP routes rely on; nothing is borrowed from the route layer. The hotel
 * and worker are NAMES resolved inside the caller's own scope, never ids.
 */

interface FoundShift {
  assignmentId: string;
  status: string;
  worker: string;
  hotel: string;
  day: string;
  rooms: { count: number; notes: string | null } | null;
}

/** Status precedence when a day holds more than one row for a worker. */
const PREFERENCE = [
  AssignmentStatus.IN_PROGRESS,
  AssignmentStatus.CONFIRMED,
  AssignmentStatus.COMPLETED,
] as string[];

async function findShift(
  ref: { worker_name: string; day: string; hotel_name?: string },
  actor: ActorContext
): Promise<FoundShift | { refused: unknown }> {
  const hotel = await resolveHotelReference(ref.hotel_name, actor);
  if (hotel.status !== 'RESOLVED') return refuseUnresolvedHotel(hotel);

  const worker = await resolveWorkerReference(ref.worker_name, actor, hotel.hotelId);
  if (worker.status !== 'RESOLVED') return refuseUnresolved(worker);

  // The owning module's scoped list, the same read the calendar makes. Filtered
  // again by worker here rather than trusting one query parameter: a hotel-day
  // is small, and "this person's shift" must never become somebody else's.
  const { data } = await assignmentService.list(
    {
      worker_id: worker.workerId,
      hotel_id: hotel.hotelId,
      from: ref.day,
      to: ref.day,
      page: 1,
      per_page: 100,
    } as never,
    toServiceActor(actor)
  );

  const rows = ((data ?? []) as Array<{
    id: string;
    status: string;
    worker_id?: string;
    day?: string | null;
    rooms_completed?: { rooms_completed?: number; notes?: string | null } | null;
  }>)
    .filter((row) => row.worker_id === undefined || row.worker_id === worker.workerId)
    .filter((row) => !row.day || row.day.slice(0, 10) === ref.day);

  if (rows.length === 0) {
    return refuse('NOT_FOUND', `${worker.fullName} has no shift at ${hotel.name} on ${ref.day}.`);
  }

  // A cancelled row and a live one can share a day (cancel, then re-place).
  // The live one is the shift a person means.
  const ranked = [...rows].sort((a, b) => {
    const ra = PREFERENCE.indexOf(a.status);
    const rb = PREFERENCE.indexOf(b.status);
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });
  const chosen = ranked[0]!;

  return {
    assignmentId: chosen.id,
    status: chosen.status,
    worker: worker.fullName,
    hotel: hotel.name,
    day: ref.day,
    rooms:
      chosen.rooms_completed && typeof chosen.rooms_completed.rooms_completed === 'number'
        ? { count: chosen.rooms_completed.rooms_completed, notes: chosen.rooms_completed.notes ?? null }
        : null,
  };
}

const isRefusal = (value: FoundShift | { refused: unknown }): value is { refused: unknown } =>
  'refused' in value;

/* ------------------------------------------------------------------ *
 * assignments.cancel_shift
 * ------------------------------------------------------------------ */

const CancelShiftArgs = z
  .object({
    worker_name: z.string().trim().min(2).max(80),
    day: isoDate,
    hotel_name: z.string().trim().min(2).max(120).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

type CancelShiftArgs = z.infer<typeof CancelShiftArgs>;

/** Null when the shift can be cancelled; otherwise the refusal saying why not. */
function whyNotCancellable(shift: FoundShift) {
  if (shift.day < todayIso()) {
    // A past CONFIRMED shift nobody attended is a no-show, not a cancellation,
    // and rewriting it as "cancelled" would erase the record of it.
    return refuse(
      'ALREADY_DONE',
      `${shift.day} has already passed, so ${shift.worker}'s shift that day cannot be cancelled. ` +
        'If they did not come, record them as absent instead.'
    );
  }
  if (shift.status === AssignmentStatus.COMPLETED) {
    return refuse('ALREADY_DONE', `${shift.worker}'s shift on ${shift.day} is already finished.`);
  }
  if (shift.status === AssignmentStatus.CONFIRMED || shift.status === AssignmentStatus.IN_PROGRESS) {
    return null;
  }
  return refuse('ALREADY_DONE', `${shift.worker}'s shift on ${shift.day} is already cancelled.`);
}

export const cancelShift = registerTool<CancelShiftArgs>({
  name: 'assignments.cancel_shift',
  description:
    "Cancels one of the manager's OWN workers' shifts on one day, so they are no longer " +
    'expected there. Use when asked to cancel a shift or take someone off the rota: "cancel ' +
    'shift for Parveen Kumar 16 September", "take Anna off tomorrow", "Schicht von Tomasz am ' +
    'Freitag stornieren". Give the worker\'s name and the day as YYYY-MM-DD, and the reason if ' +
    'one was given. Returns who, which day and which hotel. To record that someone is sick or ' +
    'on holiday use calendar.mark_worker_absence, which frees the day as well; to put the shift ' +
    'on another day use assignments.move_shift.',
  tier: 'HIGH_RISK_WRITE',
  confirm: true,

  interfaceRef:
    'IF-ASG-UpdateAssignmentStatus (assignments/service.ts update(), status CANCELLED) + IF-ASG-ListAssignments',
  approvalRef:
    APPROVED_2026_09_15_FIELD_REPORT +
    " Registration note: cancels one in-scope worker's live shift on a named day; refuses past days and finished shifts.",

  args: CancelShiftArgs,
  permission: 'staffing:write',
  scopeCheck: 'none',

  precheck: async (args, actor) => {
    const shift = await findShift(args, actor);
    return isRefusal(shift) ? shift : whyNotCancellable(shift);
  },

  invoke: async (args, actor) => {
    const shift = await findShift(args, actor);
    if (isRefusal(shift)) return shift;
    const blocked = whyNotCancellable(shift);
    if (blocked) return blocked;

    // The FIVE-argument form. The sixth, `internalBypass`, skips a
    // worker-role authorization branch and is never passed from a tool.
    await assignmentService.update(
      shift.assignmentId,
      {
        status: AssignmentStatus.CANCELLED,
        cancellation_reason: args.reason ?? 'Cancelled by a manager through Zelle',
      } as never,
      actor.userId,
      actor.role,
      actor.scope ?? null
    );

    return { worker: shift.worker, day: shift.day, hotel: shift.hotel };
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    const r = raw as { worker?: string; day?: string; hotel?: string } | null;
    if (!r) return { summary: 'Nothing was cancelled.', data: null };
    return {
      summary: `Cancelled ${r.worker}'s shift at ${r.hotel} on ${r.day}. They are no longer expected that day.`,
      data: { worker: r.worker, day: r.day, hotel: r.hotel },
    };
  },
  maxResultTokens: 100,
});

/* ------------------------------------------------------------------ *
 * rooms.record_worker_count
 * ------------------------------------------------------------------ */

const RecordRoomsArgs = z
  .object({
    worker_name: z.string().trim().min(2).max(80),
    rooms: z.number().int().min(0).max(300),
    day: isoDate.optional(),
    hotel_name: z.string().trim().min(2).max(120).optional(),
    notes: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

type RecordRoomsArgs = z.infer<typeof RecordRoomsArgs>;

/**
 * THE WORKERS' OWN ROOM LOG COMES FIRST.
 *
 * The manager-entered count is the OLDER mechanism: `rooms/service.ts` records
 * that workers logging each room in the app is "what replaces the manual
 * rooms-completed count". Both still feed one number -- analytics adds the
 * legacy counts to the logged rooms (`analytics/service.ts`, rooms_completed
 * total) -- so recording "10 rooms" for a shift on which the worker already
 * logged ten would report TWENTY, and nothing on any screen would say why.
 *
 * So a count is written only for a shift with nothing logged on it. When rooms
 * ARE logged, the assistant says how many, and where they differ from what the
 * manager said, that the missing ones belong in the room log -- where each one
 * can be inspected -- rather than in a number that cannot.
 */
async function loggedRoomCount(shift: FoundShift, actor: ActorContext): Promise<number> {
  const { rooms } = await roomService.listRoomsForAssignment(
    shift.assignmentId,
    toServiceActor(actor) as never
  );
  return rooms.length;
}

/**
 * Null when a count may be written. Otherwise the refusal saying why not.
 *
 * ONLY ON A FINISHED SHIFT, which is the owning service's rule and not this
 * tool's: `logRoomsCompleted` refuses anything but COMPLETED, because the count
 * describes a shift that is over (ADR-028). Each refusal says what will make it
 * possible rather than only that it is not.
 */
async function whyNotRecordable(shift: FoundShift, rooms: number, actor: ActorContext) {
  if (shift.status === AssignmentStatus.CANCELLED || shift.status === AssignmentStatus.REASSIGNED) {
    return refuse('NOT_FOUND', `${shift.worker}'s shift on ${shift.day} was cancelled, so there are no rooms to record.`);
  }

  const logged = await loggedRoomCount(shift, actor);
  if (logged > 0) {
    const plural = logged === 1 ? 'room' : 'rooms';
    return refuse(
      'ALREADY_DONE',
      logged === rooms
        ? `${shift.worker} has already logged ${logged} ${plural} on their ${shift.day} shift in the app, and those count automatically -- nothing more needs recording.`
        : `${shift.worker} has logged ${logged} ${plural} on their ${shift.day} shift in the app, not ${rooms}. ` +
            'Logged rooms count automatically and can each be checked, so any missing ones should be added to their room log rather than recorded as a number here.'
    );
  }

  if (shift.status === AssignmentStatus.COMPLETED) return null;
  return refuse(
    'UNAVAILABLE',
    `${shift.worker}'s shift on ${shift.day} is not finished yet and has no rooms logged so far. ` +
      'Rooms they log in the app count on their own; if they finish without logging any, tell me the number then.'
  );
}

export const recordWorkerRooms = registerTool<RecordRoomsArgs>({
  name: 'rooms.record_worker_count',
  description:
    "Records how many rooms one of the manager's OWN workers cleaned on a shift, when the worker " +
    'did not log the rooms in the app themselves; if they did, it reports how many they logged ' +
    'instead. Use when a manager reports someone\'s room count: "Parveen did 10 rooms today", ' +
    '"Anna cleaned 14 rooms yesterday", "Tomasz hat heute 12 Zimmer gemacht". Give the ' +
    "worker's name and the number of rooms, and the day as YYYY-MM-DD when it was not today. " +
    'Returns the number recorded and any number it replaced. A worker logging their own room ' +
    'numbers uses rooms.log_cleaned instead.',
  tier: 'HIGH_RISK_WRITE',
  // Confirmed although it is correctable: it writes to ANOTHER person's
  // record, and it is the figure their work is counted by.
  confirm: true,

  interfaceRef:
    'IF-ASG-LogRoomsCompleted / IF-ASG-UpdateRoomsCompleted (assignments/service.ts) + IF-ROOM-ListRoomsForAssignment (rooms/service.ts)',
  approvalRef:
    APPROVED_2026_09_15_FIELD_REPORT +
    " Registration note: writes one in-scope worker's rooms-completed count on a completed shift, merging notes rather than clearing them.",

  args: RecordRoomsArgs,
  permission: 'staffing:write',
  scopeCheck: 'none',

  precheck: async (args, actor) => {
    const shift = await findShift({ ...args, day: args.day ?? todayIso() }, actor);
    return isRefusal(shift) ? shift : whyNotRecordable(shift, args.rooms, actor);
  },

  invoke: async (args, actor) => {
    const shift = await findShift({ ...args, day: args.day ?? todayIso() }, actor);
    if (isRefusal(shift)) return shift;
    const blocked = await whyNotRecordable(shift, args.rooms, actor);
    if (blocked) return blocked;

    const serviceActor = toServiceActor(actor);

    if (shift.rooms) {
      // MERGE, NOT REPLACE. `updateRoomsCompleted` writes `notes ?? null`, so
      // a sentence that gives only a number would silently wipe the note a
      // manager wrote on the form. The stored note is carried over unless a
      // new one was actually given.
      await assignmentService.updateRoomsCompleted(
        shift.assignmentId,
        { rooms_completed: args.rooms, notes: args.notes ?? shift.rooms.notes ?? undefined } as never,
        serviceActor
      );
    } else {
      await assignmentService.logRoomsCompleted(
        shift.assignmentId,
        { rooms_completed: args.rooms, ...(args.notes ? { notes: args.notes } : {}) } as never,
        serviceActor
      );
    }

    return {
      worker: shift.worker,
      day: shift.day,
      rooms: args.rooms,
      previous: shift.rooms?.count ?? null,
    };
  },

  compress: (raw: unknown): CompactResult => {
    const refusal = asRefusal(raw);
    if (refusal) return { summary: refusal.message, data: { refusal_code: refusal.code } };
    const r = raw as { worker?: string; day?: string; rooms?: number; previous?: number | null } | null;
    if (!r) return { summary: 'Nothing was recorded.', data: null };
    const was = typeof r.previous === 'number' && r.previous !== r.rooms ? ` (it was ${r.previous})` : '';
    return {
      summary: `Recorded ${r.rooms} room${r.rooms === 1 ? '' : 's'} for ${r.worker} on ${r.day}${was}.`,
      data: { worker: r.worker, day: r.day, rooms: r.rooms, previous: r.previous ?? null },
    };
  },
  maxResultTokens: 100,
});

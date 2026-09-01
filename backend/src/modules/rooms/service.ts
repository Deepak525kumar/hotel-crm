import { AssignmentStatus, Prisma, VerificationStatus } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isHotelInScope, isScopedManagerRole } from '../../lib/scope.js';
import { todayInCalendarTimezone } from '../../lib/utils.js';
import type { UserScope } from '../../lib/jwt.js';
import { roomKey, type RoomLogDto, type RoomState } from './types.js';
import { resolveScheduledStart, resolveScheduledEnd } from '../assignments/service.js';

/**
 * How long after a shift ends a worker may still log a room they finished
 * during it (owner decision, 2026-09-02): enough to catch up on anything they
 * forgot in the last rush, without leaving the shift open to logging days
 * later.
 */
const POST_SHIFT_LOGGING_GRACE_MS = 2 * 60 * 60 * 1000;

interface Actor {
  userId: string;
  role: string;
  scope?: UserScope | null;
}

/**
 * `day` columns are `@db.Date`, which Prisma reads/writes as a Date at UTC
 * midnight. Every day boundary in this module goes through these two helpers
 * so the worker's "today", the checker's picker and the uniqueness constraint
 * all agree on what a calendar day is -- WorkerAssignment.day and
 * AssignmentService.isoDay() use the identical convention.
 *
 * The DEFAULT day comes from todayInCalendarTimezone() (Europe/Berlin,
 * OD-CAL-04), not from UTC. This is not pedantry: between 00:00 and 02:00
 * Berlin time, "today" in UTC is still yesterday, so a UTC default would have
 * shown the checker the previous day's rooms -- and given a worker on an early
 * or overnight shift an empty "logged today" list -- for two hours every
 * night. Attendance, calendar, assignments, quality and consent all anchor
 * "today" the same way, so a second convention here would also have made the
 * room picker disagree with the inspection list it feeds.
 */
function toDayDate(day?: string): Date {
  const target = day ?? todayInCalendarTimezone();
  return new Date(`${target}T00:00:00.000Z`);
}

function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

// What every read path selects. Kept in one place because four methods return
// the same DTO and a field added to one but not the others is exactly how the
// worker's tab and the checker's picker start disagreeing about a room.
const ROOM_LOG_INCLUDE = {
  hotel: { select: { name: true } },
  worker: { select: { first_name: true, last_name: true } },
  verification: {
    select: {
      id: true,
      status: true,
      score: true,
      rework_required: true,
      rework_completed_at: true,
      rework_assignments: {
        select: { id: true, status: true },
        // WorkerAssignment has no created_at; confirmed_at is its creation
        // stamp (@default(now())). Newest first, so [0] is the round the
        // worker should act on when several rounds have been raised.
        orderBy: { confirmed_at: 'desc' as const },
        take: 1,
      },
    },
  },
} satisfies Prisma.RoomLogInclude;

type RoomLogWithRelations = Prisma.RoomLogGetPayload<{ include: typeof ROOM_LOG_INCLUDE }>;

export class RoomService extends BaseService {
  /**
   * A room's quality state is DERIVED here, never stored on the log (see
   * RoomLog's schema comment). One authority -- the verification -- so the
   * worker's tab, the checker's picker and analytics can never disagree.
   */
  private deriveState(log: RoomLogWithRelations): RoomState {
    const v = log.verification;
    if (!v) return 'AWAITING_CHECK';
    // Order matters, and the two rework fields mean different things:
    //  - rework_required && !rework_completed_at -> a round is OPEN; the ball
    //    is with the worker (and a 20-minute clock may be running).
    //  - rework_completed_at set -> the worker submitted, and completeRework
    //    auto-passed the room, clearing rework_required. `status` is PASSED
    //    here, so testing PASSED first would collapse this into a plain pass
    //    and the checker's "review photos" group would always be empty --
    //    which would quietly remove the only human review of an auto-passed
    //    fix. Reopening a room (assignRework) resets rework_completed_at to
    //    null, so a second open round correctly reads NEEDS_REWORK again.
    if (v.rework_required && !v.rework_completed_at) return 'NEEDS_REWORK';
    if (v.rework_completed_at) return 'REWORK_SUBMITTED';
    if (v.status === VerificationStatus.PASSED) return 'PASSED';
    // FAILED, and NEEDS_REWORK without a round attached, both read the same to
    // the worker: the room was not accepted and it is theirs to fix.
    return 'NEEDS_REWORK';
  }

  private toDto(log: RoomLogWithRelations): RoomLogDto {
    const state = this.deriveState(log);
    const workerName = [log.worker?.first_name, log.worker?.last_name].filter(Boolean).join(' ').trim();
    // Only an OPEN rework is actionable. Once the worker has submitted their
    // evidence the room auto-passes, so linking them back into the rework
    // screen would invite a second upload for work already accepted.
    const openRework =
      state === 'NEEDS_REWORK' ? (log.verification?.rework_assignments?.[0]?.id ?? null) : null;
    return {
      id: log.id,
      assignment_id: log.assignment_id,
      hotel_id: log.hotel_id,
      hotel_name: log.hotel?.name ?? null,
      worker_id: log.worker_id,
      worker_name: workerName || null,
      day: isoDay(log.day),
      room_number: log.room_number,
      state,
      logged_at: log.logged_at.toISOString(),
      verification_id: log.verification_id,
      score: log.verification?.score ?? null,
      rework_assignment_id: openRework,
      // The lock: once an inspection references this room, the log is frozen
      // so a check can never be orphaned from the room it inspected.
      editable: log.verification_id === null,
    };
  }

  /**
   * The worker logs a room they have finished.
   *
   * Self-service and self-scoped: the assignment must be the caller's own, so
   * there is no request field a worker could use to log a room against
   * somebody else's shift. Requires them to be checked in (owner decision) --
   * IN_PROGRESS or COMPLETED -- so a room cannot be logged by someone who
   * never arrived.
   */
  async logRoom(assignmentId: string, roomNumber: string, actor: Actor, ip?: string): Promise<RoomLogDto> {
    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: assignmentId },
      // work_request_id/job_request_id are what resolveScheduledStart/End read
      // the shift's clock through -- a WorkerAssignment carries no time of its
      // own (see their comment).
      select: {
        id: true,
        worker_id: true,
        hotel_id: true,
        day: true,
        status: true,
        rework_of_assignment_id: true,
        work_request_id: true,
        job_request_id: true,
      },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    // Identity, not role: the only person who may log what they cleaned is
    // the person who cleaned it. Deliberately applied to every role including
    // admin -- an admin logging rooms as a worker would be falsifying that
    // worker's own accountability record, and the manager's live view exists
    // for oversight instead.
    if (assignment.worker_id !== actor.userId) {
      throw new ForbiddenError('You can only log rooms for your own shift');
    }

    // A rework assignment must never carry its own room log: rework changes
    // the ORIGINAL room's state through its verification. Without this, room
    // 412 would appear twice in the checker's picker -- once from the original
    // shift and once from the rework shift -- and the day's room count would
    // double-count every reworked room.
    if (assignment.rework_of_assignment_id !== null) {
      throw new ValidationError(
        'Rooms are logged on the original shift. This is a rework shift -- upload your rework evidence instead.'
      );
    }

    if (
      assignment.status !== AssignmentStatus.IN_PROGRESS &&
      assignment.status !== AssignmentStatus.COMPLETED
    ) {
      throw new ValidationError('Check in to your shift before logging rooms');
    }

    // Owner decision (2026-09-02): a room may only be logged DURING the shift
    // it was cleaned on, plus a two-hour grace afterwards for anything the
    // worker forgot in the last rush.
    //
    // The status check above is not sufficient on its own, in both
    // directions. A worker who checks in early is IN_PROGRESS before their
    // shift has started, and a COMPLETED shift stayed loggable forever -- so
    // rooms could be attributed to a shift days after it ended, which is also
    // the window in which a checker has already inspected and closed it out.
    //
    // Skipped when the shift has no resolvable time. A calendar-placed
    // assignment carries a day but no start/end (resolveScheduledStart's own
    // comment: a data-model gap tracked in #365), and there is no clock to
    // bound it against -- so it keeps the status-only rule rather than being
    // refused outright for a gap that is not the worker's doing.
    const scheduledStart = await resolveScheduledStart(this.prisma, assignment);
    if (scheduledStart) {
      const now = new Date();
      if (now < scheduledStart) {
        throw new ValidationError('Your shift has not started yet -- you can log rooms once it does');
      }
      // resolveScheduledEnd handles the overnight case (an end time earlier
      // than the start time belongs to the following day), so the grace is
      // measured from the real end instant, not a wall-clock comparison.
      const scheduledEnd = await resolveScheduledEnd(this.prisma, assignment);
      if (scheduledEnd && now.getTime() > scheduledEnd.getTime() + POST_SHIFT_LOGGING_GRACE_MS) {
        throw new ValidationError(
          'This shift ended more than two hours ago. Ask your manager to add any room you missed.'
        );
      }
    }

    const trimmed = roomNumber.trim();
    const key = roomKey(trimmed);

    try {
      const created = await this.prisma.roomLog.create({
        data: {
          assignment_id: assignment.id,
          hotel_id: assignment.hotel_id,
          worker_id: assignment.worker_id,
          // Taken from the assignment, never from the request: the day a room
          // was cleaned is the day of the shift it was cleaned on.
          day: assignment.day,
          room_number: trimmed,
          room_key: key,
        },
        include: ROOM_LOG_INCLUDE,
      });
      await this.logAudit(
        actor.userId,
        actor.role,
        'MODIFY',
        'ROOM_LOG',
        created.id,
        { action: 'log_room', room_number: trimmed, assignment_id: assignment.id },
        ip
      );
      return this.toDto(created);
    } catch (error) {
      // P2002 on (hotel_id, day, room_key) -- the hard block. Answer with WHO
      // already has it: "already logged" alone sends the worker hunting, and
      // the usual cause is two people cleaning the same corridor.
      if ((error as { code?: string }).code === 'P2002') {
        const holder = await this.prisma.roomLog.findFirst({
          where: { hotel_id: assignment.hotel_id, day: assignment.day, room_key: key },
          include: { worker: { select: { first_name: true, last_name: true } } },
        });
        const name = holder
          ? [holder.worker?.first_name, holder.worker?.last_name].filter(Boolean).join(' ').trim()
          : '';
        throw new ConflictError(
          name
            ? `Room ${trimmed} was already logged today by ${name}`
            : `Room ${trimmed} was already logged today`
        );
      }
      throw error;
    }
  }

  /**
   * Correct a mis-typed room. Allowed only while no inspection references the
   * log (owner decision) -- after that the record is the anchor for a check
   * and its rework history.
   */
  async updateRoom(roomLogId: string, roomNumber: string, actor: Actor, ip?: string): Promise<RoomLogDto> {
    const existing = await this.prisma.roomLog.findUnique({
      where: { id: roomLogId },
      select: { id: true, worker_id: true, hotel_id: true, day: true, verification_id: true, room_number: true },
    });
    if (!existing) throw new NotFoundError('Room log not found');
    if (existing.worker_id !== actor.userId) {
      throw new ForbiddenError('You can only change your own room log');
    }
    if (existing.verification_id !== null) {
      throw new ConflictError('This room has already been checked and can no longer be changed');
    }

    const trimmed = roomNumber.trim();
    const key = roomKey(trimmed);
    try {
      const updated = await this.prisma.roomLog.update({
        where: { id: roomLogId },
        data: { room_number: trimmed, room_key: key },
        include: ROOM_LOG_INCLUDE,
      });
      await this.logAudit(
        actor.userId,
        actor.role,
        'MODIFY',
        'ROOM_LOG',
        roomLogId,
        { action: 'update_room' },
        ip,
        { room_number: existing.room_number },
        { room_number: trimmed }
      );
      return this.toDto(updated);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictError(`Room ${trimmed} was already logged today`);
      }
      throw error;
    }
  }

  /** Remove a mis-tapped room. Same lock as updateRoom. */
  async deleteRoom(roomLogId: string, actor: Actor, ip?: string): Promise<void> {
    const existing = await this.prisma.roomLog.findUnique({
      where: { id: roomLogId },
      select: { id: true, worker_id: true, verification_id: true, room_number: true },
    });
    if (!existing) throw new NotFoundError('Room log not found');
    if (existing.worker_id !== actor.userId) {
      throw new ForbiddenError('You can only remove your own room log');
    }
    if (existing.verification_id !== null) {
      throw new ConflictError('This room has already been checked and can no longer be removed');
    }
    await this.prisma.roomLog.delete({ where: { id: roomLogId } });
    await this.logAudit(
      actor.userId,
      actor.role,
      'MODIFY',
      'ROOM_LOG',
      roomLogId,
      { action: 'delete_room', room_number: existing.room_number },
      ip
    );
  }

  /**
   * The worker's own room tab.
   *
   * Two lists rather than one, because they answer different questions:
   *  - `rooms`: what I logged on `day` (default today).
   *  - `needs_rework`: rooms of MINE still awaiting my fix, on ANY day.
   *
   * The second list exists because createReworkAssignment dates the rework
   * shift TODAY even when the room was cleaned yesterday (ADR-069). A
   * day-filtered list alone would silently hide yesterday's open rework, which
   * is the one item with a 20-minute escalation clock attached to it.
   */
  async listMyRooms(actor: Actor, day?: string): Promise<{ rooms: RoomLogDto[]; needs_rework: RoomLogDto[] }> {
    const target = toDayDate(day);
    const [rooms, openRework] = await Promise.all([
      this.prisma.roomLog.findMany({
        where: { worker_id: actor.userId, day: target },
        include: ROOM_LOG_INCLUDE,
        orderBy: { logged_at: 'desc' },
      }),
      this.prisma.roomLog.findMany({
        where: {
          worker_id: actor.userId,
          verification: { rework_required: true, rework_completed_at: null },
        },
        include: ROOM_LOG_INCLUDE,
        orderBy: { logged_at: 'desc' },
      }),
    ]);
    return {
      rooms: rooms.map((r) => this.toDto(r)),
      needs_rework: openRework.map((r) => this.toDto(r)),
    };
  }

  /**
   * Resolves which hotels the caller may see room activity for, on `day`.
   *
   * This is the single scope authority for every non-worker read in this
   * module. Mirrors QualityService.listInspectableWorkers' rules exactly, so a
   * checker cannot see rooms through this module that they could not see
   * through the inspection list:
   *  - admin: everything.
   *  - manager / regional_manager: their JWT scope (hotel, or every hotel in
   *    their group).
   *  - checker: ONLY hotels where they themselves are rostered and active that
   *    day. A checker's JWT carries no scope claim, so being on site is what
   *    grants visibility -- and it means a checker sees nothing on a day off.
   *  - anyone else (worker): nothing. Workers read their own rooms through
   *    listMyRooms, never this path.
   *
   * Returns null for "no hotel restriction" (admin) and a (possibly empty)
   * list otherwise. An empty list means "in scope for nothing", which every
   * caller renders as an empty result rather than an error.
   */
  private async resolveVisibleHotelIds(actor: Actor, day: Date): Promise<string[] | null> {
    if (actor.role === 'admin') return null;

    if (isScopedManagerRole(actor.role)) {
      const scope = actor.scope ?? null;
      if (!scope) return [];
      if (scope.type === 'hotel' && scope.hotel_id) return [scope.hotel_id];
      if (scope.type === 'hotel_group' && scope.hotel_group_id) {
        const hotels = await this.prisma.hotel.findMany({
          where: { hotel_group_id: scope.hotel_group_id },
          select: { id: true },
        });
        return hotels.map((h) => h.id);
      }
      return [];
    }

    if (actor.role === 'checker') {
      const own = await this.prisma.workerAssignment.findMany({
        where: {
          worker_id: actor.userId,
          day,
          status: { in: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.COMPLETED] },
        },
        select: { hotel_id: true },
      });
      return [...new Set(own.map((a) => a.hotel_id))];
    }

    return [];
  }

  /**
   * The checker's room picker -- what replaced their free-text room field.
   *
   * Grouped by what the checker can DO with each room (owner decision):
   *  - awaiting_check: logged, never inspected. The default working list.
   *  - reworked: auto-passed after the worker submitted their fix. Surfaced so
   *    the checker can review the photos and reopen the room if the fix is
   *    not good enough -- without this group, auto-pass would mean nobody
   *    ever looks at the evidence.
   *  - already_checked: inspected this day. Shown rather than hidden so a
   *    checker can re-check a room deliberately, and so the list reflects the
   *    real state of the floor.
   */
  async listRoomsForPicker(
    actor: Actor,
    query: { day?: string; hotel_id?: string } = {}
  ): Promise<{
    day: string;
    awaiting_check: RoomLogDto[];
    reworked: RoomLogDto[];
    already_checked: RoomLogDto[];
  }> {
    const target = toDayDate(query.day);
    const visible = await this.resolveVisibleHotelIds(actor, target);

    // An explicit hotel_id narrows, never widens: asking for a hotel outside
    // the caller's scope is a 403, not an empty list, so the parameter cannot
    // be used to probe which hotels exist or have activity.
    if (query.hotel_id) {
      if (visible !== null && !visible.includes(query.hotel_id)) {
        throw new ForbiddenError('That hotel is not in your scope');
      }
      // For a scoped manager the scope check is the authority; for admin
      // (visible === null) any hotel is permitted.
      if (isScopedManagerRole(actor.role)) {
        const inScope = await isHotelInScope(actor.scope ?? null, query.hotel_id);
        if (!inScope) throw new ForbiddenError('That hotel is not in your scope');
      }
    }

    const hotelFilter = query.hotel_id
      ? { hotel_id: query.hotel_id }
      : visible === null
        ? {}
        : { hotel_id: { in: visible } };

    // Short-circuit: `{ in: [] }` would return nothing anyway, but this makes
    // "in scope for nothing" explicit rather than an accident of Prisma.
    if (visible !== null && visible.length === 0 && !query.hotel_id) {
      return { day: isoDay(target), awaiting_check: [], reworked: [], already_checked: [] };
    }

    const logs = await this.prisma.roomLog.findMany({
      where: { day: target, ...hotelFilter },
      include: ROOM_LOG_INCLUDE,
      orderBy: { room_key: 'asc' },
    });

    const dtos = logs.map((l) => this.toDto(l));
    return {
      day: isoDay(target),
      awaiting_check: dtos.filter((d) => d.state === 'AWAITING_CHECK'),
      reworked: dtos.filter((d) => d.state === 'REWORK_SUBMITTED'),
      already_checked: dtos.filter((d) => d.state === 'PASSED' || d.state === 'NEEDS_REWORK'),
    };
  }

  /**
   * The manager/RM live view: who logged what, at my hotels, on `day`.
   *
   * This is what replaces the manual "rooms completed" count they used to type
   * in after the shift -- the number is now a consequence of the workers' own
   * logs rather than a second, hand-entered source of truth.
   */
  async listRoomsForHotels(
    actor: Actor,
    query: { day?: string; hotel_id?: string } = {}
  ): Promise<{ day: string; rooms: RoomLogDto[]; by_worker: { worker_id: string; worker_name: string | null; rooms_logged: number }[] }> {
    const picker = await this.listRoomsForPicker(actor, query);
    const rooms = [...picker.awaiting_check, ...picker.reworked, ...picker.already_checked];

    const counts = new Map<string, { worker_id: string; worker_name: string | null; rooms_logged: number }>();
    for (const room of rooms) {
      const entry = counts.get(room.worker_id) ?? {
        worker_id: room.worker_id,
        worker_name: room.worker_name,
        rooms_logged: 0,
      };
      entry.rooms_logged += 1;
      counts.set(room.worker_id, entry);
    }

    return {
      day: picker.day,
      rooms: rooms.sort((a, b) => a.room_number.localeCompare(b.room_number)),
      by_worker: [...counts.values()].sort((a, b) => b.rooms_logged - a.rooms_logged),
    };
  }

  /**
   * Every room logged on ONE shift, for whoever is looking at that shift.
   *
   * The three reads above answer "my rooms", "rooms I could inspect" and
   * "today at my hotels" -- self-scoped, picker-scoped and hotel-and-today
   * scoped respectively. None of them answers "what was logged on THIS
   * assignment", which is what an assignment page needs, and the gap was
   * visible: the manual rooms-completed card was retired when the room log
   * landed and nothing replaced it there, so a manager opening a shift saw no
   * room information at all -- including for past shifts, which the
   * today-scoped read can never cover.
   *
   * Scoped to match who may see the assignment itself rather than inventing a
   * second rule: the worker it belongs to, a checker/manager/RM whose scope
   * covers its hotel, and admin. Deliberately reuses isHotelInScope, the same
   * primitive listRoomsForPicker's hotel filter is built on.
   */
  async listRoomsForAssignment(
    assignmentId: string,
    actor: Actor
  ): Promise<{ assignment_id: string; rooms: RoomLogDto[] }> {
    const assignment = await this.prisma.workerAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, worker_id: true, hotel_id: true },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    const isOwnShift = assignment.worker_id === actor.userId;
    if (!isOwnShift && actor.role !== 'admin') {
      // A worker may only ever read their own shift; every other role is
      // allowed the shift's hotel if their scope covers it.
      if (actor.role === 'worker') {
        throw new ForbiddenError('You can only see the rooms logged on your own shift');
      }
      const inScope = await isHotelInScope(actor.scope ?? null, assignment.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('That shift is not at one of your hotels');
      }
    }

    const rooms = await this.prisma.roomLog.findMany({
      where: { assignment_id: assignment.id },
      include: ROOM_LOG_INCLUDE,
      orderBy: { room_number: 'asc' },
    });

    return { assignment_id: assignment.id, rooms: rooms.map((r) => this.toDto(r)) };
  }

  /**
   * Room numbers already used at a hotel, for the worker's typeahead.
   *
   * This is what makes "trim + upper-case only" normalisation sufficient
   * (owner decision): rather than guessing that "0412" means "412", the input
   * offers what has genuinely been used here before, so spellings converge by
   * suggestion. Read across all days on purpose -- last month's room list is
   * exactly the useful suggestion set.
   */
  async listRoomSuggestions(actor: Actor, hotelId: string): Promise<string[]> {
    // A worker may only ask about a hotel they are actually rostered at, on
    // any day -- otherwise this endpoint would enumerate other hotels' room
    // numbering for anyone with a login.
    if (actor.role === 'worker' || actor.role === 'checker') {
      const rostered = await this.prisma.workerAssignment.findFirst({
        where: { worker_id: actor.userId, hotel_id: hotelId },
        select: { id: true },
      });
      if (!rostered) throw new ForbiddenError('You have no shifts at that hotel');
    } else if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, hotelId);
      if (!inScope) throw new ForbiddenError('That hotel is not in your scope');
    } else if (actor.role !== 'admin') {
      throw new ForbiddenError('Not permitted');
    }

    const rows = await this.prisma.roomLog.findMany({
      where: { hotel_id: hotelId },
      select: { room_number: true },
      distinct: ['room_key'],
      orderBy: { room_key: 'asc' },
      take: 500,
    });
    return rows.map((r) => r.room_number);
  }

  /**
   * Resolves a room log for an inspection, for the quality module.
   *
   * The room-first flow means the checker's selection IS the identity of the
   * work being inspected: the log supplies assignment, worker and room number,
   * so the client sends one id and the server derives the rest rather than
   * trusting three separate fields to agree.
   */
  async resolveForInspection(roomLogId: string): Promise<{
    id: string;
    assignment_id: string;
    worker_id: string;
    hotel_id: string;
    room_number: string;
    verification_id: string | null;
  }> {
    const log = await this.prisma.roomLog.findUnique({
      where: { id: roomLogId },
      select: {
        id: true,
        assignment_id: true,
        worker_id: true,
        hotel_id: true,
        room_number: true,
        verification_id: true,
      },
    });
    if (!log) throw new NotFoundError('Room not found');
    return log;
  }
}

export const roomService = new RoomService();

import {
  AssignmentStatus,
  OutboxSourceModule,
  OutboxTransport,
  Prisma,
  JobRequest,
  JobRequestSkillSlot,
  WorkRequestStatus,
} from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { DatabaseTransaction } from '../../lib/db.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import {
  isWorkerEligibleForHotel,
  listEligibleHotelIds,
  listEligibleWorkerIds,
} from '../../lib/roster-scope.js';
import {
  isWorkerFreeOnDay,
  isWorkerAbsentOnDay,
  ACTIVE_ASSIGNMENT_STATUSES,
  BLOCKING_ABSENCE_KINDS,
  assignmentService,
} from '../assignments/service.js';
import { refreshWorkerOverallRating } from '../quality/service.js';
import { notificationService } from '../notifications/service.js';
import { isHotelInScope } from '../../middleware/permissions.js';
// From lib/scope.js, not the middleware re-export — see geo/service.ts's note:
// pure predicates, so suites mocking the permissions middleware need not stub them.
import { isScopedManagerRole, isSelfScopedRole } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import {
  AcceptBroadcastResultDto,
  BroadcastEligibilityDto,
  CreateWorkRequestInput,
  JobRequestSkillSlotDto,
  ListWorkRequestsQuery,
  RaiseBroadcastInput,
  UpdateWorkRequestInput,
  WorkRequestDto,
} from './types.js';

interface Actor {
  userId: string;
  role: string;
  scope?: UserScope | null;
}

// Allowed MANUAL status transitions for a WorkRequest. PARTIALLY_FILLED and
// FILLED are absent by design, not by omission: as of 2026-08-07 they are
// derived at read time from skill_slots (see deriveFillStatus below) rather
// than stored, so there is no transition into them to authorize. The earlier
// version of this comment promised a "later PR" would write them from the
// assignment pipeline; that PR never landed and the derived approach replaces
// it -- one maintained source (confirmed_count) instead of two that can
// disagree. EXPIRED is set by a scheduled job.
const ALLOWED_TRANSITIONS: Partial<Record<WorkRequestStatus, WorkRequestStatus[]>> = {
  [WorkRequestStatus.DRAFT]: [WorkRequestStatus.OPEN, WorkRequestStatus.CANCELLED],
  [WorkRequestStatus.OPEN]: [WorkRequestStatus.CANCELLED],
  [WorkRequestStatus.PARTIALLY_FILLED]: [WorkRequestStatus.CANCELLED],
};

export class JobRequestService extends BaseService {
  /**
   * Fill state, derived at read time (2026-08-07).
   *
   * WorkRequestStatus declares PARTIALLY_FILLED and FILLED, but nothing ever
   * wrote either: every write site sets DRAFT, OPEN, CANCELLED or EXPIRED,
   * confirmed by grep across the whole module. The comment on
   * ALLOWED_TRANSITIONS said they were "driven by the assignment pipeline
   * (later PR)" -- that PR never landed, so a fully-staffed broadcast still
   * read OPEN forever.
   *
   * Derived rather than stored, deliberately. skill_slots.confirmed_count is
   * already the maintained source of truth (acceptBroadcast increments,
   * cancellation decrements) and this file's own raiseBroadcast() doc calls
   * skill_slots "the SOLE authority for any decision logic". Storing a second
   * copy would mean two write paths that can disagree -- exactly the drift
   * class already fixed twice in this codebase. A derived value cannot go
   * stale.
   *
   * Only applies to broadcasts (rows with skill slots). A marketplace request
   * has no per-slot data, so its status is left exactly as stored.
   */
  private deriveFillStatus(
    stored: WorkRequestStatus,
    skillSlots?: JobRequestSkillSlot[]
  ): WorkRequestStatus {
    // Terminal/manual states always win: a cancelled or expired request is
    // not "partially filled" no matter what its slots say, and a DRAFT has
    // not been published yet.
    if (
      stored === WorkRequestStatus.CANCELLED ||
      stored === WorkRequestStatus.EXPIRED ||
      stored === WorkRequestStatus.DRAFT
    ) {
      return stored;
    }
    if (!skillSlots || skillSlots.length === 0) return stored;

    const needed = skillSlots.reduce((sum, s) => sum + s.headcount, 0);
    const confirmed = skillSlots.reduce((sum, s) => sum + s.confirmed_count, 0);
    if (needed === 0) return stored;
    if (confirmed >= needed) return WorkRequestStatus.FILLED;
    if (confirmed > 0) return WorkRequestStatus.PARTIALLY_FILLED;
    return stored;
  }

  private toDto(wr: JobRequest, skillSlots?: JobRequestSkillSlot[]): WorkRequestDto {
    return {
      id: wr.id,
      hotel_id: wr.hotel_id,
      created_by_id: wr.created_by_id,
      position: wr.position,
      workers_needed: wr.workers_needed,
      // Same dead-column problem as the analytics dashboard fix: the stored
      // workers_confirmed is written by nothing. Derive it from the slots
      // that ARE maintained, falling back to the stored value for a
      // marketplace row that has no slots.
      workers_confirmed:
        skillSlots && skillSlots.length > 0
          ? skillSlots.reduce((sum, s) => sum + s.confirmed_count, 0)
          : wr.workers_confirmed,
      shift_date: wr.shift_date.toISOString().slice(0, 10),
      shift_start_time: wr.shift_start_time,
      shift_end_time: wr.shift_end_time,
      hourly_rate: wr.hourly_rate ? Number(wr.hourly_rate) : null,
      currency: wr.currency,
      description: wr.description,
      requirements: wr.requirements,
      status: this.deriveFillStatus(wr.status, skillSlots),
      published_at: wr.published_at?.toISOString() ?? null,
      expires_at: wr.expires_at?.toISOString() ?? null,
      filled_at: wr.filled_at?.toISOString() ?? null,
      cancelled_at: wr.cancelled_at?.toISOString() ?? null,
      cancellation_reason: wr.cancellation_reason,
      created_at: wr.created_at.toISOString(),
      updated_at: wr.updated_at.toISOString(),
      ...(skillSlots && skillSlots.length > 0
        ? { skill_slots: skillSlots.map((s) => this.toSkillSlotDto(s)) }
        : {}),
    };
  }

  private toSkillSlotDto(slot: JobRequestSkillSlot): JobRequestSkillSlotDto {
    return {
      id: slot.id,
      skill: slot.skill,
      headcount: slot.headcount,
      confirmed_count: slot.confirmed_count,
    };
  }

  async create(
    input: CreateWorkRequestInput,
    actor: Actor
  ): Promise<WorkRequestDto> {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: input.hotel_id } });
    if (!hotel || hotel.deleted_at) throw new NotFoundError('Hotel not found');

    // GD-05: per-hotel "pause new jobs" toggle (REQ-CRM-008). A business-state
    // precondition, not an authorization check — ConflictError (409), matching
    // this method's other state-based rejections, not ForbiddenError.
    if (!hotel.accepting_jobs) {
      throw new ConflictError('This hotel is not currently accepting new work requests');
    }

    // Epic 8 (SIR-JOBD-002 / FIND-SEC-002): a scope-bound manager (Hotel or Regional)
    // may only create work requests for hotels in their scope claim (retired
    // M-4). ADR-030 §3 C-23 grants RM `✓ᶜ`; isHotelInScope() resolves its
    // hotel_group claim, so the same branch serves both roles.
    // Admin keeps unconditional cross-hotel access (unchanged, by design).
    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, input.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot create a work request for this hotel');
      }
    }

    const publishing = input.status === 'OPEN';
    const wr = await this.prisma.$transaction(async (tx) => {
      const createdWr = await tx.jobRequest.create({
        data: {
          hotel_id: input.hotel_id,
          created_by_id: actor.userId,
          position: input.position,
          workers_needed: input.workers_needed,
          shift_date: new Date(`${input.shift_date}T00:00:00.000Z`),
          shift_start_time: input.shift_start_time,
          shift_end_time: input.shift_end_time,
          hourly_rate: input.hourly_rate ?? null,
          currency: input.currency ?? 'EUR',
          description: input.description ?? null,
          requirements: input.requirements ?? null,
          status: publishing ? WorkRequestStatus.OPEN : WorkRequestStatus.DRAFT,
          published_at: publishing ? new Date() : null,
          expires_at: input.expires_at ? new Date(input.expires_at) : null,
        },
      });

      await this.logAudit(actor.userId, actor.role, 'CREATE', 'WORK_REQUEST', createdWr.id, {
        hotel_id: createdWr.hotel_id,
        status: createdWr.status,
      }, undefined, undefined, undefined, tx);

      return createdWr;
    });

    return this.toDto(wr);
  }

  async list(
    query: ListWorkRequestsQuery,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<{ data: WorkRequestDto[]; total: number }> {
    const where: Prisma.JobRequestWhereInput = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
      ...(query.status ? { status: query.status as WorkRequestStatus } : {}),
      ...(query.position ? { position: query.position } : {}),
      ...(query.shift_date
        ? { shift_date: new Date(`${query.shift_date}T00:00:00.000Z`) }
        : {}),
      // Same discriminator closeExpiredBroadcasts() uses below.
      ...(query.is_broadcast === true ? { skill_slots: { some: {} } } : {}),
      ...(query.is_broadcast === false ? { skill_slots: { none: {} } } : {}),
    };

    // PATCH-04: non-management roles only see requests for hotels where they
    // hold an ACTIVE roster membership. isSelfScopedRole() rather than
    // `role !== 'admin' && role !== 'manager'`, which MATCHED regional_manager
    // and silently roster-scoped an RM as if it were a worker (a 200 with the
    // wrong rows) while the manager scope filters above skipped it entirely.
    if (isSelfScopedRole(actor.role)) {
      const hotelIds = await listEligibleHotelIds(actor.userId);
      if (hotelIds.length === 0) return { data: [], total: 0 };
      where.hotel_id = query.hotel_id
        ? hotelIds.includes(query.hotel_id)
          ? query.hotel_id
          : '__none__'
        : { in: hotelIds };

      // 2026-08-13 fix: this scoped a worker by hotel but never by SKILL,
      // while acceptBroadcast() hard-rejects a worker who does not hold the
      // slot's skill ("Cannot accept this broadcast", ForbiddenError). So a
      // CLEANER browsing the board saw MAINTENANCE-only broadcasts, and the
      // only way to discover they could never take one was to tap accept and
      // get a 403. list() and acceptBroadcast() now agree on skill.
      //
      // Only BROADCASTS are filtered. A marketplace request carries no skill
      // slots at all, and skill is not part of its acceptance path, so those
      // rows stay visible exactly as before -- hence the `none` arm rather
      // than a bare `some` filter, which would have hidden every marketplace
      // request from every worker.
      //
      // Deliberately scoped to `worker`, not all self-scoped roles: a checker
      // is self-scoped too but does not accept broadcasts, and its
      // EmploymentRecord skills (if any) describe something else entirely.
      if (actor.role === 'worker') {
        const record = await this.prisma.employmentRecord.findUnique({
          where: { user_id: actor.userId },
          select: { skills: true },
        });
        const skills = record?.skills ?? [];
        where.OR = [
          { skill_slots: { none: {} } },
          ...(skills.length > 0 ? [{ skill_slots: { some: { skill: { in: skills } } } }] : []),
        ];
      }
    } else if (isScopedManagerRole(actor.role)) {
      // IDOR fix (2026-08-08): create()/update()/raiseBroadcast() in this
      // same file already scope a manager/regional_manager to their own
      // hotel/hotel_group claim -- list() never did, so a manager could
      // read every work request platform-wide. Same isHotelInScope-shaped
      // narrowing as attendance/service.ts's list().
      const scope = actor.scope ?? null;
      if (!scope) {
        where.hotel_id = { in: [] };
      } else if (scope.type === 'hotel') {
        where.hotel_id = scope.hotel_id;
      } else if (scope.type === 'hotel_group') {
        where.hotel = { hotel_group_id: scope.hotel_group_id };
      }
      // scope.type === 'global' -> no added restriction.
    }

    const [records, total] = await Promise.all([
      this.prisma.jobRequest.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: [{ shift_date: 'desc' }, { created_at: 'desc' }],
        // Regression correction: list() previously omitted skill_slots,
        // making broadcast job requests indistinguishable from marketplace
        // requests. getById() already returned this field; list() now
        // matches that behavior.
        include: { skill_slots: true },
      }),
      this.prisma.jobRequest.count({ where }),
    ]);

    return { data: records.map((r) => this.toDto(r, r.skill_slots)), total };
  }

  async getById(
    id: string,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<WorkRequestDto> {
    const wr = await this.prisma.jobRequest.findUnique({
      where: { id },
      include: { skill_slots: true },
    });
    if (!wr) throw new NotFoundError('Work request not found');

    if (isSelfScopedRole(actor.role)) {
      const eligible = await isWorkerEligibleForHotel(actor.userId, wr.hotel_id);
      if (!eligible) throw new ForbiddenError('Cannot access this work request');
    } else if (isScopedManagerRole(actor.role)) {
      // IDOR fix (2026-08-08): same gap as list() above -- a manager/RM
      // could read any single work request by id, unscoped.
      const inScope = await isHotelInScope(actor.scope ?? null, wr.hotel_id);
      if (!inScope) throw new ForbiddenError('Cannot access this work request');
    }

    const dto = this.toDto(wr, wr.skill_slots);

    // Epic 9 PR 9.2 (TREQ-011): WorkApplication was dropped in this same PR —
    // there is nothing left to populate `my_application` from. Per the
    // reviewed decision, the field is kept on the response as an
    // always-null temporary compatibility stub (ADR-058's additive/
    // non-breaking migration philosophy) rather than removed, because the
    // mobile client still reads it and its companion cleanup PR (which
    // removes the field from both sides) has not landed yet. Delete this
    // branch and the field once that mobile companion PR ships.
    if (actor.role === 'worker' || actor.role === 'checker') {
      dto.my_application = null;
    }

    return dto;
  }

  async update(
    id: string,
    input: UpdateWorkRequestInput,
    actor: Actor
  ): Promise<WorkRequestDto> {
    const wr = await this.prisma.jobRequest.findUnique({ where: { id } });
    if (!wr) throw new NotFoundError('Work request not found');

    // Epic 8 (SIR-JOBD-002 / FIND-SEC-002): a scope-bound manager (Hotel or Regional)
    // may only patch work requests belonging to a hotel in their scope claim
    // (retired M-4). ADR-030 §3 C-23.
    // Admin keeps unconditional cross-hotel access (unchanged).
    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, wr.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot modify this work request');
      }
    }

    const data: Prisma.JobRequestUpdateInput = {};
    let statusChanged = false;
    // True only for the DRAFT -> OPEN publish transition (the transition table
    // permits OPEN exclusively from DRAFT), so unrelated PATCHes never notify.
    let isPublishing = false;

    if (input.status && input.status !== wr.status) {
      if (!ALLOWED_TRANSITIONS[wr.status]?.includes(input.status as WorkRequestStatus)) {
        throw new ConflictError(`Cannot transition from ${wr.status} to ${input.status}`);
      }
      const next = input.status as WorkRequestStatus;
      data.status = next;
      statusChanged = true;
      if (next === WorkRequestStatus.OPEN) {
        isPublishing = true;
        if (!wr.published_at) data.published_at = new Date();
      }
      if (next === WorkRequestStatus.CANCELLED) {
        data.cancelled_at = new Date();
        data.cancellation_reason = input.cancellation_reason ?? null;
      }
    }

    // Editable fields are only mutable while the request has not yet been
    // published — once OPEN, terms are locked except for status changes.
    const editable = wr.status === WorkRequestStatus.DRAFT;
    if (editable) {
      if (input.position !== undefined) data.position = input.position;
      if (input.workers_needed !== undefined) data.workers_needed = input.workers_needed;
      if (input.shift_date !== undefined)
        data.shift_date = new Date(`${input.shift_date}T00:00:00.000Z`);
      if (input.shift_start_time !== undefined) data.shift_start_time = input.shift_start_time;
      if (input.shift_end_time !== undefined) data.shift_end_time = input.shift_end_time;
      if (input.hourly_rate !== undefined) data.hourly_rate = input.hourly_rate;
      if (input.currency !== undefined) data.currency = input.currency;
      if (input.description !== undefined) data.description = input.description;
      if (input.requirements !== undefined) data.requirements = input.requirements;
      if (input.expires_at !== undefined) data.expires_at = new Date(input.expires_at);
    }

    if (statusChanged) data.version = { increment: 1 };

    // ADR-029 (GD-01, Epic 7 PR 7.3): the publish write and the roster
    // fan-out enqueue join one transaction, so the outbox rows can never be
    // created for an update that didn't commit (or be lost for one that
    // did). This is also the fan-out latency fix OQ-NOTIF-09 flagged: each
    // enqueue is a cheap local insert, never a synchronous external
    // network call — delivery happens later, out-of-band, via the Platform
    // Worker.
    let updated: JobRequest;
    if (isPublishing) {
      const workerIds = await listEligibleWorkerIds(wr.hotel_id);
      updated = await this.prisma.$transaction(async (tx) => {
        const wrUpdated = await tx.jobRequest.update({ where: { id }, data });
        await this.enqueueRosterPublished(tx, wrUpdated, workerIds);
        await this.logAudit(actor.userId, actor.role, 'UPDATE', 'WORK_REQUEST', id, {
          from_status: wr.status,
          to_status: wrUpdated.status,
          ...(wrUpdated.status === WorkRequestStatus.CANCELLED
            ? { cancellation_reason: wrUpdated.cancellation_reason }
            : {}),
        }, undefined, undefined, undefined, tx);
        return wrUpdated;
      });
    } else {
      updated = await this.prisma.$transaction(async (tx) => {
        const wrUpdated = await tx.jobRequest.update({ where: { id }, data });
        await this.logAudit(actor.userId, actor.role, 'UPDATE', 'WORK_REQUEST', id, {
          from_status: wr.status,
          to_status: wrUpdated.status,
          ...(wrUpdated.status === WorkRequestStatus.CANCELLED
            ? { cancellation_reason: wrUpdated.cancellation_reason }
            : {}),
        }, undefined, undefined, undefined, tx);
        return wrUpdated;
      });
    }

    // Job-dispatch lifecycle cascade fix (2026-08-05): cancelling a
    // JobRequest previously never touched its already-assigned
    // WorkerAssignments -- a worker with a CONFIRMED assignment against a
    // cancelled request stayed CONFIRMED indefinitely. Runs AFTER the
    // parent's own transaction commits, not inside it: AssignmentService.
    // update() opens its own transaction and is not composable inside this
    // one (same "delegates to the assignment owner's own service" boundary
    // CalendarService.autoCancelSameDayAssignment() already established) --
    // a crash between the two leaves the parent cancelled but assignments
    // still active, the same accepted tradeoff that existing delegation
    // already carries, not a new risk.
    if (updated.status === WorkRequestStatus.CANCELLED) {
      await this.cascadeCancelAssignments(id, actor);
    }

    return this.toDto(updated);
  }

  // Job-dispatch lifecycle cascade fix (2026-08-05): cancels every active
  // (CONFIRMED/IN_PROGRESS) WorkerAssignment tied to this JobRequest, via
  // EITHER work_request_id (marketplace-lineage) or job_request_id
  // (broadcast-accept-lineage) -- the two nullable FKs a WorkerAssignment
  // can carry back to the same JobRequest id (see WorkerAssignment's own
  // schema comment). Delegates each cancellation to
  // AssignmentService.update() one at a time (not a bulk updateMany) so
  // every one of that method's own side effects fires per assignment:
  // WorkerOverallRating recompute, the JobRequestSkillSlot.confirmed_count
  // decrement (Bug 3), and the cancellation notification (this session's
  // notification fix) -- reusing the single source of truth for "what
  // happens when an assignment is cancelled" rather than partially
  // reimplementing it here.
  private async cascadeCancelAssignments(jobRequestId: string, actor: Actor): Promise<void> {
    const assignments = await this.prisma.workerAssignment.findMany({
      where: {
        OR: [{ work_request_id: jobRequestId }, { job_request_id: jobRequestId }],
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      },
      select: { id: true },
    });

    for (const a of assignments) {
      await assignmentService.update(
        a.id,
        { status: 'CANCELLED', cancellation_reason: 'The work request was cancelled' },
        actor.userId,
        actor.role,
        actor.scope ?? null
      );
    }
  }

  // Enqueue a WORK_REQUEST_PUBLISHED notification for every active worker on
  // the hotel roster, inside the caller's publish transaction (ADR-029 §2).
  private async enqueueRosterPublished(
    tx: DatabaseTransaction,
    wr: JobRequest,
    workerIds: string[]
  ): Promise<void> {
    for (const workerId of workerIds) {
      await notificationService.enqueue(
        {
          recipientId: workerId,
          type: 'WORK_REQUEST_PUBLISHED',
          title: 'New Work Available',
          message: `A new ${wr.position} shift is open for applications.`,
          data: { work_request_id: wr.id, hotel_id: wr.hotel_id },
          hotelId: wr.hotel_id,
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.WORK_REQUESTS,
          producerService: 'JobRequestService',
        },
        tx
      );
    }
  }

  /**
   * Epic 9 PR 9.7 (TREQ-002/TRULE-002, MIG-GAP-04/05): manager raises a
   * standalone broadcast JobRequest specifying skill(s) and headcount per
   * skill. Creates the JobRequest and its JobRequestSkillSlot rows in one
   * transaction, published immediately (a broadcast is raised OPEN — there
   * is no DRAFT step for this path, unlike the marketplace create() flow).
   *
   * As of Epic 9 PR 9.8, this method also notifies each eligible worker per
   * skill slot (TREQ-003 delivery half) in the same transaction — see
   * enqueueBroadcastNotifications() below. It still does NOT let anyone
   * accept (PR 9.9) or register an auto-close job (PR 9.10) — this method
   * persists the broadcast, its skill×headcount breakdown, and its
   * notifications, closing TREQ-002/TRULE-002's "calendar edits never emit a
   * broadcast" clause by construction: this is the *only* creation path that
   * populates skill_slots or enqueues a JOB_REQUEST_BROADCAST notification,
   * and it is never invoked by placeOnCalendar() (PR 9.5) or by the
   * marketplace create()/update() methods above.
   *
   * skill_slots is the sole source of truth for a broadcast's skill×headcount
   * data. `position`/`workers_needed` ARE also written on the created row,
   * but only as a compatibility projection derived from skill_slots (a
   * summary string / sum, never independently authored) so existing
   * consumers that read those legacy columns (list()/getById()'s DTO
   * mapping, analytics/service.ts's _sum aggregate) keep working for a
   * broadcast row without a broadcast-aware branch in either. This is a
   * deliberate transitional-compatibility decision (Option B, confirmed
   * 2026-07-29 pre-merge review of PR 9.7), not an oversight — see
   * MODULE_SPEC.md's 0.3.4 Review-and-Change-Log entry. Nothing in this
   * service (or any future PR 9.8/9.9 logic) may read `position` back as
   * authoritative for a broadcast; only skill_slots may be.
   */
  async raiseBroadcast(input: RaiseBroadcastInput, actor: Actor): Promise<WorkRequestDto> {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: input.hotel_id } });
    if (!hotel || hotel.deleted_at) throw new NotFoundError('Hotel not found');

    if (!hotel.accepting_jobs) {
      throw new ConflictError('This hotel is not currently accepting new work requests');
    }

    // Same scope-authz shape as create()/update() above (Epic 8,
    // SIR-JOBD-002/FIND-SEC-002): a scope-bound manager (Hotel or Regional) may
    // only raise a broadcast for a hotel in their scope claim (ADR-030 C-23). Admin keeps unconditional cross-hotel
    // access.
    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, input.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot raise a broadcast for this hotel');
      }
    }

    // Decision (transitional compatibility, Option B — confirmed 2026-07-29
    // pre-merge review of PR 9.7): a broadcast row DOES populate the legacy
    // position/workers_needed columns, derived (not manager-authored) from
    // the skill×headcount breakdown below, alongside skill_slots. This is
    // deliberate, not accidental: list()/getById()'s DTO mapping and
    // analytics/service.ts's existing _sum(workers_needed/workers_confirmed)
    // aggregate have no other field to read for a broadcast row today, and
    // giving them a derived value keeps a broadcast visible/summable through
    // those existing surfaces without adding a broadcast-aware branch to
    // either. skill_slots remains the SOLE authority for any decision logic
    // (eligibility, future arbitration) — position is a display-only
    // derivative, never read back for behavior. Superseded once TREQ-011
    // retires the marketplace fields entirely.
    const totalWorkersNeeded = input.skills.reduce((sum, s) => sum + s.headcount, 0);
    const positionSummary = input.skills.map((s) => `${s.headcount}x ${s.skill}`).join(', ');

    const { wr, slots } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.jobRequest.create({
        data: {
          hotel_id: input.hotel_id,
          created_by_id: actor.userId,
          position: positionSummary,
          workers_needed: totalWorkersNeeded,
          shift_date: new Date(`${input.shift_date}T00:00:00.000Z`),
          shift_start_time: input.shift_start_time,
          shift_end_time: input.shift_end_time,
          hourly_rate: input.hourly_rate ?? null,
          currency: input.currency ?? 'EUR',
          description: input.description ?? null,
          status: WorkRequestStatus.OPEN,
          published_at: new Date(),
          skill_slots: {
            create: input.skills.map((s) => ({
              skill: s.skill,
              headcount: s.headcount,
            })),
          },
        },
        include: { skill_slots: true },
      });
      // Epic 9 PR 9.8 (TREQ-003 delivery half): same transaction-join
      // pattern enqueueRosterPublished() uses below — the notification
      // enqueue can never be created for a broadcast that didn't commit, or
      // be lost for one that did.
      await this.enqueueBroadcastNotifications(tx, created, created.skill_slots);
      
      await this.logAudit(actor.userId, actor.role, 'CREATE', 'WORK_REQUEST', created.id, {
        hotel_id: created.hotel_id,
        status: created.status,
        skills: input.skills,
      }, undefined, undefined, undefined, tx);
      
      return { wr: created, slots: created.skill_slots };
    });

    return this.toDto(wr, slots);
  }

  /**
   * Epic 9 PR 9.7 (TREQ-003/TRULE-002/TRULE-006, MIG-GAP-04): eligibility
   * computation for a broadcast JobRequest — per skill slot, the eligible
   * worker set is {hotel-group roster ∩ matching skill ∩ free that day}.
   * Reuses listEligibleWorkerIds() (roster-scope.ts) for the roster/scope
   * dimension and isWorkerFreeOnDay() (PR 9.6, assignments/service.ts) for
   * the daily-exclusivity dimension, rather than duplicating either.
   *
   * Role-scoped correction (post-Epic-9 discovery): this route has no
   * requireRole gate (a worker must be able to call it to know whether they
   * can accept), so the response itself is now scoped by caller role
   * instead of exposing the full eligible_worker_ids roster to everyone —
   * see SkillSlotEligibilityDto's own doc comment. admin/manager get
   * eligible_count per slot (a headcount — both existing UI consumers only
   * ever rendered a count, never the raw ids); worker/checker additionally
   * get `eligible: boolean`, their own inclusion only, never any other
   * worker's id.
   *
   * Read-only: does not notify (PR 9.8) or reserve a slot (PR 9.9).
   */
  async getBroadcastEligibility(
    id: string,
    actor: { userId: string; role: string; scope?: UserScope | null }
  ): Promise<BroadcastEligibilityDto> {
    const wr = await this.prisma.jobRequest.findUnique({
      where: { id },
      include: { skill_slots: true },
    });
    if (!wr) throw new NotFoundError('Work request not found');
    if (wr.skill_slots.length === 0) {
      throw new ConflictError('This work request is not a broadcast (no skill slots)');
    }

    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, wr.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot view eligibility for this work request');
      }
    }

    const internal = await this.computeBroadcastEligibility(wr, wr.skill_slots);
    const isWorkerLike = actor.role === 'worker' || actor.role === 'checker';

    return {
      job_request_id: internal.job_request_id,
      hotel_id: internal.hotel_id,
      shift_date: internal.shift_date,
      slots: internal.slots.map((slot) => ({
        skill: slot.skill,
        headcount: slot.headcount,
        confirmed_count: slot.confirmed_count,
        eligible_count: slot.eligible_worker_ids.length,
        ...(isWorkerLike ? { eligible: slot.eligible_worker_ids.includes(actor.userId) } : {}),
      })),
    };
  }

  /**
   * Epic 9 PR 9.7's eligibility computation, extracted so PR 9.8's
   * notification step (below) can reuse the exact same eligible-worker-set
   * logic getBroadcastEligibility() exposes via its route, rather than
   * recalculating it with separate code. Takes the JobRequest/skill_slots
   * directly (not an id + a fresh findUnique) so raiseBroadcast() can call
   * this with the row it just created in the same transaction, with no
   * extra read.
   *
   * INTERNAL ONLY: returns the raw eligible_worker_ids per slot —
   * enqueueBroadcastNotifications() (below) needs the actual ids to notify.
   * Never return this shape directly from a public route; getBroadcastEligibility()
   * projects it into the role-scoped SkillSlotEligibilityDto before responding.
   */
  private async computeBroadcastEligibility(
    wr: JobRequest,
    skillSlots: JobRequestSkillSlot[]
  ): Promise<{
    job_request_id: string;
    hotel_id: string;
    shift_date: string;
    slots: { skill: JobRequestSkillSlot['skill']; headcount: number; confirmed_count: number; eligible_worker_ids: string[] }[];
  }> {
    const rosterWorkerIds = await listEligibleWorkerIds(wr.hotel_id);
    if (rosterWorkerIds.length === 0) {
      return {
        job_request_id: wr.id,
        hotel_id: wr.hotel_id,
        shift_date: wr.shift_date.toISOString().slice(0, 10),
        slots: skillSlots.map((slot) => ({
          skill: slot.skill,
          headcount: slot.headcount,
          confirmed_count: slot.confirmed_count,
          eligible_worker_ids: [],
        })),
      };
    }

    const rosterRecords = await this.prisma.employmentRecord.findMany({
      where: { user_id: { in: rosterWorkerIds } },
      select: { user_id: true, skills: true },
    });
    const skillsByWorker = new Map(rosterRecords.map((r) => [r.user_id, r.skills]));

    // Release-audit fix (High): previously one Promise.all-fanned-out
    // isWorkerFreeOnDay() call PER roster worker — a separate `findFirst`
    // query per worker, hitting the default Prisma connection pool
    // (num_cpus*2+1, unconfigured) with N concurrent connection requests. A
    // 500-worker roster fires 500 simultaneous queries; under real load this
    // exhausts the pool and produces P2024 timeouts across every other
    // concurrent request, not just this one. Single batched query instead —
    // `busyWorkerIds` is the set of workers with an active assignment that
    // day; every roster worker NOT in it is free.
    const busyAssignments = await this.prisma.workerAssignment.findMany({
      where: {
        worker_id: { in: rosterWorkerIds },
        day: wr.shift_date,
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      },
      select: { worker_id: true },
    });
    const busyWorkerIds = new Set(busyAssignments.map((a) => a.worker_id));

    // Critical fix (2026-08-08): a roster worker with a declared SICK/
    // VACATION absence that day must not appear as eligible for a
    // broadcast slot -- same batched-query shape as busyAssignments above
    // (one query for the whole roster, not one per worker).
    //
    // Filters on BLOCKING_ABSENCE_KINDS explicitly rather than treating any
    // CalendarAbsence row as blocking, so a future informational kind
    // (TRAINING, NOTE, ...) added to the enum cannot silently start
    // excluding workers from staffing -- see isWorkerAbsentOnDay()'s own
    // doc comment (assignments/service.ts), which this mirrors. Day-grain,
    // not time-grain: a partial-day absence blocks the whole day.
    const absences = await this.prisma.calendarAbsence.findMany({
      where: {
        worker_id: { in: rosterWorkerIds },
        day: wr.shift_date,
        kind: { in: BLOCKING_ABSENCE_KINDS },
      },
      select: { worker_id: true },
    });
    const absentWorkerIds = new Set(absences.map((a) => a.worker_id));

    const freeWorkerIds = new Set(
      rosterWorkerIds.filter((workerId) => !busyWorkerIds.has(workerId) && !absentWorkerIds.has(workerId))
    );

    const slots = skillSlots.map((slot) => {
      const eligibleWorkerIds = rosterWorkerIds.filter(
        (workerId) =>
          freeWorkerIds.has(workerId) && (skillsByWorker.get(workerId) ?? []).includes(slot.skill)
      );
      return {
        skill: slot.skill,
        headcount: slot.headcount,
        confirmed_count: slot.confirmed_count,
        eligible_worker_ids: eligibleWorkerIds,
      };
    });

    return {
      job_request_id: wr.id,
      hotel_id: wr.hotel_id,
      shift_date: wr.shift_date.toISOString().slice(0, 10),
      slots,
    };
  }

  /**
   * Epic 9 PR 9.8 (TREQ-003 delivery half): enqueue a JOB_REQUEST_BROADCAST
   * notification to every eligible worker for each skill slot on a
   * newly-raised broadcast, inside the caller's own creation transaction —
   * same transaction-join pattern ADR-029/Epic 7 PR 7.3 established
   * (enqueueRosterPublished() above). Reuses
   * computeBroadcastEligibility() (PR 9.7's eligibility logic) rather than
   * recalculating the eligible-worker set. A worker eligible for more than
   * one skill slot on the same broadcast (e.g. holds both CLEANER and
   * WAITER) receives one notification per matching slot — each slot is a
   * distinct opening, not a duplicate of the same one.
   *
   * Does NOT implement first-accept arbitration, optimistic concurrency,
   * "requirement fulfilled" detection, or auto-close — those are PR
   * 9.9/9.10's scope. This method only notifies; it does not reserve or
   * claim anything.
   */
  private async enqueueBroadcastNotifications(
    tx: DatabaseTransaction,
    wr: JobRequest,
    skillSlots: JobRequestSkillSlot[]
  ): Promise<void> {
    const eligibility = await this.computeBroadcastEligibility(wr, skillSlots);
    for (const slot of eligibility.slots) {
      for (const workerId of slot.eligible_worker_ids) {
        await notificationService.enqueue(
          {
            recipientId: workerId,
            type: 'JOB_REQUEST_BROADCAST',
            title: 'New Job Available',
            message: `A ${slot.skill} shift needs coverage on ${eligibility.shift_date}.`,
            data: { work_request_id: wr.id, hotel_id: wr.hotel_id, skill: slot.skill },
            hotelId: wr.hotel_id,
            transports: [OutboxTransport.PUSH],
            sourceModule: OutboxSourceModule.WORK_REQUESTS,
            producerService: 'JobRequestService',
          },
          tx
        );
      }
    }
  }

  /**
   * Epic 9 PR 9.9 (TREQ-004/TRULE-003, TREQ-005/TRULE-004, MIG-GAP-06): a
   * worker accepts one skill slot on a broadcast JobRequest. First-accept
   * wins via optimistic concurrency — a transactional conditional
   * `updateMany` on JobRequestSkillSlot.confirmed_count, structurally
   * identical in shape to the retired work-applications/service.ts
   * approve()'s slot-claim (ADR-057 item 2), narrowed by ADR-057's
   * 2026-07-30 addendum to a bare confirmed_count guard (no separate
   * version column) since JobRequestSkillSlot arbitrates at the per-skill
   * grain, not the whole-request grain the retired approve() claimed
   * against. On `claimed.count === 0` (slot already filled by a faster
   * claimant), returns the "requirement fulfilled" response instead of
   * throwing (TREQ-005) — not an error, not silence. On success, creates a
   * WorkerAssignment directly inside the same transaction, with
   * job_request_id set (PR 9.3's FK) and work_request_id left null (PR
   * 9.5's nullability relax) — the identical disposition PR 9.5's
   * placeOnCalendar() already established; see that method's own forward-
   * note. assigned_by_id is set to the broadcast's own created_by_id (the
   * manager who raised it) rather than the accepting worker, since
   * assigned_by_id's "assignment_manager" relation has no natural
   * self-accept value and the raising manager's action is what made this
   * assignment possible (escalated and confirmed by the commissioning
   * human before this PR's implementation).
   *
   * Does NOT implement auto-close, scheduler registration, or any PR
   * 9.10 behavior — only the accept/arbitration path.
   */
  async acceptBroadcast(
    id: string,
    skill: JobRequestSkillSlot['skill'],
    actor: { userId: string; role: string }
  ): Promise<AcceptBroadcastResultDto> {
    const wr = await this.prisma.jobRequest.findUnique({
      where: { id },
      include: { skill_slots: true },
    });
    if (!wr) throw new NotFoundError('Work request not found');
    if (wr.skill_slots.length === 0) {
      throw new ConflictError('This work request is not a broadcast (no skill slots)');
    }
    if (wr.status !== WorkRequestStatus.OPEN) {
      throw new ConflictError('This broadcast is no longer open for acceptance');
    }

    const slot = wr.skill_slots.find((s) => s.skill === skill);
    if (!slot) {
      throw new NotFoundError('No matching skill slot on this broadcast');
    }

    // Worker-side eligibility: roster membership (hotel-group scope, same
    // check getById()'s worker branch uses), matching skill, and free that
    // day. A worker who doesn't hold this skill or isn't roster-eligible at
    // this hotel cannot accept regardless of the slot's fill state —
    // deny-by-default, mirrors every other worker-facing read/write in this
    // module.
    const eligible = await isWorkerEligibleForHotel(actor.userId, wr.hotel_id);
    if (!eligible) {
      throw new ForbiddenError('Cannot accept this broadcast');
    }
    const record = await this.prisma.employmentRecord.findUnique({
      where: { user_id: actor.userId },
      select: { skills: true },
    });
    if (!record || !record.skills.includes(skill)) {
      throw new ForbiddenError('Cannot accept this broadcast');
    }
    const free = await isWorkerFreeOnDay(actor.userId, wr.shift_date);
    if (!free) {
      throw new ConflictError('Already assigned that day');
    }

    // Critical fix (2026-08-08): block accepting a broadcast slot on a day
    // the worker has a declared SICK/VACATION absence.
    if (await isWorkerAbsentOnDay(actor.userId, wr.shift_date)) {
      throw new ConflictError('You have a sick/vacation absence marked for this day');
    }

    let assignmentId: string | null = null;
    try {
      assignmentId = await this.prisma.$transaction(async (tx) => {
        // First-accept-wins optimistic-concurrency claim (ADR-057, addendum
        // 2026-07-30): the WHERE clause's confirmed_count < headcount
        // predicate is what Postgres re-evaluates against post-lock values
        // for any concurrent claimant on this same row, making this single
        // UPDATE atomic without a separate version column.
        const claimed = await tx.jobRequestSkillSlot.updateMany({
          where: { id: slot.id, confirmed_count: { lt: slot.headcount } },
          data: { confirmed_count: { increment: 1 } },
        });
        if (claimed.count === 0) return null;

        const assignment = await tx.workerAssignment.create({
          data: {
            work_request_id: null,
            job_request_id: wr.id,
            skill_slot_id: slot.id,
            worker_id: actor.userId,
            hotel_id: wr.hotel_id,
            assigned_by_id: wr.created_by_id,
            status: AssignmentStatus.CONFIRMED,
            day: wr.shift_date,
          },
        });

        // Aggregate refresh (2026-08-07): total_assignments counts ALL of a
        // worker's rows regardless of status (quality/service.ts:41), so
        // accepting a broadcast changes it. Without this the aggregate went
        // stale, and because the upsert in refreshWorkerOverallRating() is
        // the only creator of a WorkerOverallRating row, a worker whose only
        // activity was accepting broadcasts never appeared on the leaderboard.
        await refreshWorkerOverallRating(tx, actor.userId);

        // Deferred-bug batch (2026-08-07): a broadcast accept never wrote a
        // CalendarEntry, only a WorkerAssignment -- placeOnCalendar() (the
        // manual-placement path) is the only other WorkerAssignment creation
        // site and it writes both rows in one transaction (see its comment
        // above). Without this, the calendar grid (which reads exclusively
        // from CalendarEntry, not WorkerAssignment) never showed a shift a
        // worker got by accepting a broadcast.
        await tx.calendarEntry.create({
          data: {
            assignment_id: assignment.id,
            worker_id: actor.userId,
            hotel_id: wr.hotel_id,
            day: wr.shift_date,
            placed_by_id: wr.created_by_id,
          },
        });

        await this.logAudit(actor.userId, actor.role, 'ACCEPT_BROADCAST', 'WORKER_ASSIGNMENT', assignment.id, {
          job_request_id: wr.id,
          skill,
        }, undefined, undefined, undefined, tx);

        return assignment.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Worker already has an assignment for this day');
      }
      throw error;
    }

    if (assignmentId === null) {
      // Lost the first-accept-wins race -- no WorkerAssignment was created,
      // so there's no WORKER_ASSIGNMENT resource to attach an audit entry
      // to, but the attempt itself is worth a record (an admin investigating
      // "why didn't this worker get the shift" should be able to see the
      // attempt, not just silence). Logged against the WORK_REQUEST instead.
      // This is unwrapped because no primary mutation occurred.
      await this.logAudit(actor.userId, actor.role, 'ACCEPT_BROADCAST_LOST_RACE', 'WORK_REQUEST', wr.id, {
        skill,
      });
      return { status: 'requirement_fulfilled', job_request_id: wr.id, skill };
    }

    return { status: 'accepted', assignment_id: assignmentId, job_request_id: wr.id, skill };
  }

  /**
   * Epic 9 PR 9.10 (TREQ-006/TRULE-005, MIG-GAP-09): manager manually closes
   * an unfilled broadcast before the 6h auto-close job (below) would. Reuses
   * the module's existing manual-transition validation shape (OPEN ->
   * EXPIRED is intentionally NOT added to the shared ALLOWED_TRANSITIONS
   * table used by update() — that table also governs the marketplace
   * create()/update() flow, which has no EXPIRED-via-manual-action concept;
   * this method validates the OPEN + is-a-broadcast precondition itself,
   * the same wr.skill_slots.length === 0 guard getBroadcastEligibility()/
   * acceptBroadcast() already use to detect a non-broadcast row). Notifies
   * the raising manager (JobRequest.created_by_id) — the same recipient
   * closeExpiredBroadcasts() (JobRequestAutoCloseJob, auto-close-job.ts)
   * notifies, so a manager sees identical notification behavior regardless
   * of which path closed their broadcast.
   */
  async manualClose(id: string, actor: Actor): Promise<WorkRequestDto> {
    const wr = await this.prisma.jobRequest.findUnique({
      where: { id },
      include: { skill_slots: true },
    });
    if (!wr) throw new NotFoundError('Work request not found');
    if (wr.skill_slots.length === 0) {
      throw new ConflictError('This work request is not a broadcast (no skill slots)');
    }
    if (wr.status !== WorkRequestStatus.OPEN) {
      throw new ConflictError('This broadcast is not open');
    }

    if (isScopedManagerRole(actor.role)) {
      const inScope = await isHotelInScope(actor.scope ?? null, wr.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot close this broadcast');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const closed = await tx.jobRequest.update({
        where: { id },
        data: { status: WorkRequestStatus.EXPIRED, version: { increment: 1 } },
      });
      await this.enqueueJobRequestClosed(tx, closed, 'manual');
      
      await this.logAudit(actor.userId, actor.role, 'MANUAL_CLOSE', 'WORK_REQUEST', id, {
        from_status: wr.status,
        to_status: closed.status,
      }, undefined, undefined, undefined, tx);
      
      return closed;
    });

    return this.toDto(updated, wr.skill_slots);
  }

  /**
   * Epic 9 PR 9.10 (TREQ-006, MIG-GAP-09): notify the raising manager that
   * their unfilled broadcast has closed — shared by manualClose() above and
   * closeExpiredBroadcasts() below, so both closure paths produce identical
   * notification behavior. `reason` distinguishes the two in the
   * notification payload only; it does not change delivery mechanics.
   */
  private async enqueueJobRequestClosed(
    tx: DatabaseTransaction,
    wr: JobRequest,
    reason: 'auto' | 'manual',
    // 2026-08-13 fix (E2E integration audit): closeExpiredBroadcasts() below
    // now only ever reaches this call for a broadcast that is NOT fully
    // staffed (a fully-filled one is skipped, never closed-as-unfilled), but
    // it CAN be partially filled -- 2 of 3 slots claimed when the 6-hour
    // window ran out. The old message unconditionally said "unfilled,"
    // which actively hid that a manager already had workers coming and
    // could prompt them to duplicate the broadcast (real overstaffing risk
    // the original report flagged). Optional and 'auto'-only: manualClose()
    // is an explicit, informed decision by the manager who is looking at
    // the broadcast right now, not an automated claim about its state.
    fillSummary?: { confirmed: number; needed: number }
  ): Promise<void> {
    const isPartiallyFilled = reason === 'auto' && fillSummary && fillSummary.confirmed > 0;
    await notificationService.enqueue(
      {
        recipientId: wr.created_by_id,
        type: 'JOB_REQUEST_CLOSED',
        title: 'Job Request Closed',
        message:
          reason === 'auto'
            ? isPartiallyFilled
              ? `Your ${wr.position} broadcast closed after 6 hours with only ${fillSummary!.confirmed}/${fillSummary!.needed} positions filled.`
              : `Your ${wr.position} broadcast closed unfilled after 6 hours.`
            : `Your ${wr.position} broadcast was closed manually.`,
        data: { work_request_id: wr.id, hotel_id: wr.hotel_id, reason },
        hotelId: wr.hotel_id,
        transports: [OutboxTransport.PUSH],
        sourceModule: OutboxSourceModule.WORK_REQUESTS,
        producerService: 'JobRequestService',
      },
      tx
    );
  }

  /**
   * Epic 9 PR 9.10 (TREQ-006/TRULE-005, MIG-GAP-09): closes every broadcast
   * JobRequest still OPEN more than 6 hours after creation — the scheduled-
   * job half of auto-close, called by JobRequestAutoCloseJob.run()
   * (auto-close-job.ts) on the Platform Worker's Scheduler. Confirms
   * ADR-057's Platform-Worker-not-BullMQ decision in code (no new job
   * runtime introduced).
   *
   * Batched (same bounded-loop shape SessionSweepJob/GeoRetentionSweepJob
   * already establish for the Platform Worker's other scheduled jobs) so a
   * large backlog cannot hold one long-running query. Each row closes (and
   * notifies) inside its own transaction, mirroring manualClose()'s shape,
   * rather than one batch update — closing must join a notification enqueue
   * per row (each broadcast has a distinct created_by_id to notify), so a
   * single bulk updateMany cannot serve both purposes.
   *
   * 2026-08-13 fix (E2E integration audit, confirmed by reading the code —
   * fill status is derived at READ time from skill_slots and never written
   * back to the stored `status` column by design, per deriveFillStatus()'s
   * own doc comment). This sweep queried that raw stored column with no
   * check against skill_slots at all, so a FULLY-staffed broadcast still
   * read OPEN in the DB and got swept into EXPIRED here, generating a false
   * "closed unfilled after 6 hours" notification for a manager whose
   * broadcast had, in fact, succeeded. Now fetches skill_slots and skips
   * (never closes) any broadcast that is already fully filled — it needs no
   * closing at all; deriveFillStatus() already reads it as FILLED everywhere
   * it's displayed, regardless of the stored column staying OPEN.
   *
   * Loop termination is now based on how many rows were actually CLOSED in a
   * batch, not how many were fetched: a skipped (fully-filled) row remains
   * OPEN and stale, so an unconditional stale.length check would refetch it
   * every iteration. Breaking when a batch closes nothing guarantees
   * termination regardless of how many filled-but-still-OPEN rows exist.
   */
  async closeExpiredBroadcasts(cutoff: Date, batchSize: number): Promise<number> {
    let total = 0;
    // Keyset pagination on `id` rather than Prisma's `cursor` option: the
    // cursor form made `stale`'s own type depend on a variable assigned from
    // `stale`, which TypeScript rejects as a circular initializer (TS7022).
    // An `id > cursor` where-clause paginates identically with no such cycle.
    let cursorId: string | undefined;
    for (;;) {
      const stale = await this.prisma.jobRequest.findMany({
        where: {
          status: WorkRequestStatus.OPEN,
          created_at: { lt: cutoff },
          skill_slots: { some: {} },
          ...(cursorId === undefined ? {} : { id: { gt: cursorId } }),
        },
        include: { skill_slots: true },
        take: batchSize,
        orderBy: { id: 'asc' },
      });
      if (stale.length === 0) break;

      cursorId = stale[stale.length - 1].id;

      let closedThisBatch = 0;
      for (const wr of stale) {
        const needed = wr.skill_slots.reduce((sum, s) => sum + s.headcount, 0);
        const confirmed = wr.skill_slots.reduce((sum, s) => sum + s.confirmed_count, 0);
        // Fully staffed -- not actually stale in any sense that matters.
        // Leave it OPEN; deriveFillStatus() already reads FILLED for it.
        if (needed > 0 && confirmed >= needed) continue;

        await this.prisma.$transaction(async (tx) => {
          const closed = await tx.jobRequest.update({
            where: { id: wr.id },
            data: { status: WorkRequestStatus.EXPIRED, version: { increment: 1 } },
          });
          await this.enqueueJobRequestClosed(tx, closed, 'auto', { confirmed, needed });

          // Audit gap: manualClose() logs MANUAL_CLOSE, but this scheduled
          // path previously logged nothing at all -- a broadcast could expire
          // with zero audit trail. `logAudit(null, 'system', ...)` matches the
          // existing convention for scheduled-job-initiated actions (see
          // employee-management/service.ts's contract-lapse deactivation).
          await this.logAudit(null, 'system', 'AUTO_CLOSE', 'WORK_REQUEST', wr.id, {
            from_status: wr.status,
            to_status: closed.status,
            confirmed,
            needed,
          }, undefined, undefined, undefined, tx);
        });
        closedThisBatch++;
      }
      total += closedThisBatch;

      // A short page is the last page -- stop without spending another query.
      // Note what is deliberately NOT here: the old `|| closedThisBatch === 0`
      // clause. That one ended the sweep whenever a full batch happened to be
      // entirely fully-staffed rows, silently leaving every later expired
      // broadcast open. Keyset pagination advances past those rows instead, so
      // only a genuinely short page ends the loop.
      if (stale.length < batchSize) break;
    }
    return total;
  }
}

export const jobRequestService = new JobRequestService();

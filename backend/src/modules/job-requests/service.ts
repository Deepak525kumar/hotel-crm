import {
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
import { isWorkerFreeOnDay } from '../assignments/service.js';
import { notificationService } from '../notifications/service.js';
import { isHotelInScope } from '../../middleware/permissions.js';
import type { UserScope } from '../../lib/jwt.js';
import {
  BroadcastEligibilityDto,
  CreateWorkRequestInput,
  JobRequestSkillSlotDto,
  ListWorkRequestsQuery,
  RaiseBroadcastInput,
  SkillSlotEligibilityDto,
  UpdateWorkRequestInput,
  WorkRequestDto,
} from './types.js';

interface Actor {
  userId: string;
  role: string;
  scope?: UserScope | null;
}

// Allowed status transitions for a WorkRequest. PARTIALLY_FILLED/FILLED are
// driven by the assignment pipeline (later PR) — managers may only move a
// request through the manual states below. EXPIRED is set by a scheduled job.
const ALLOWED_TRANSITIONS: Partial<Record<WorkRequestStatus, WorkRequestStatus[]>> = {
  [WorkRequestStatus.DRAFT]: [WorkRequestStatus.OPEN, WorkRequestStatus.CANCELLED],
  [WorkRequestStatus.OPEN]: [WorkRequestStatus.CANCELLED],
  [WorkRequestStatus.PARTIALLY_FILLED]: [WorkRequestStatus.CANCELLED],
};

export class JobRequestService extends BaseService {
  private toDto(wr: JobRequest, skillSlots?: JobRequestSkillSlot[]): WorkRequestDto {
    return {
      id: wr.id,
      hotel_id: wr.hotel_id,
      created_by_id: wr.created_by_id,
      position: wr.position,
      workers_needed: wr.workers_needed,
      workers_confirmed: wr.workers_confirmed,
      shift_date: wr.shift_date.toISOString().slice(0, 10),
      shift_start_time: wr.shift_start_time,
      shift_end_time: wr.shift_end_time,
      hourly_rate: wr.hourly_rate ? Number(wr.hourly_rate) : null,
      currency: wr.currency,
      description: wr.description,
      requirements: wr.requirements,
      status: wr.status,
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

    // Epic 8 (SIR-JOBD-002 / FIND-SEC-002): a manager may only create work
    // requests for hotels in their scope claim (retired M-4).
    // Admin keeps unconditional cross-hotel access (unchanged, by design).
    if (actor.role === 'manager') {
      const inScope = await isHotelInScope(actor.scope ?? null, input.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot create a work request for this hotel');
      }
    }

    const publishing = input.status === 'OPEN';

    const wr = await this.prisma.jobRequest.create({
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

    await this.logAudit(actor.userId, actor.role, 'CREATE', 'WORK_REQUEST', wr.id, {
      hotel_id: wr.hotel_id,
      status: wr.status,
    });

    return this.toDto(wr);
  }

  async list(
    query: ListWorkRequestsQuery,
    actor: { userId: string; role: string }
  ): Promise<{ data: WorkRequestDto[]; total: number }> {
    const where: Prisma.JobRequestWhereInput = {
      ...(query.hotel_id ? { hotel_id: query.hotel_id } : {}),
      ...(query.status ? { status: query.status as WorkRequestStatus } : {}),
      ...(query.position ? { position: query.position } : {}),
      ...(query.shift_date
        ? { shift_date: new Date(`${query.shift_date}T00:00:00.000Z`) }
        : {}),
    };

    // PATCH-04: non-management roles only see requests for hotels where they
    // hold an ACTIVE roster membership.
    if (actor.role !== 'admin' && actor.role !== 'manager') {
      const hotelIds = await listEligibleHotelIds(actor.userId);
      if (hotelIds.length === 0) return { data: [], total: 0 };
      where.hotel_id = query.hotel_id
        ? hotelIds.includes(query.hotel_id)
          ? query.hotel_id
          : '__none__'
        : { in: hotelIds };
    }

    const [records, total] = await Promise.all([
      this.prisma.jobRequest.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: [{ shift_date: 'desc' }, { created_at: 'desc' }],
      }),
      this.prisma.jobRequest.count({ where }),
    ]);

    return { data: records.map((r) => this.toDto(r)), total };
  }

  async getById(
    id: string,
    actor: { userId: string; role: string }
  ): Promise<WorkRequestDto> {
    const wr = await this.prisma.jobRequest.findUnique({
      where: { id },
      include: { skill_slots: true },
    });
    if (!wr) throw new NotFoundError('Work request not found');

    if (actor.role !== 'admin' && actor.role !== 'manager') {
      const eligible = await isWorkerEligibleForHotel(actor.userId, wr.hotel_id);
      if (!eligible) throw new ForbiddenError('Cannot access this work request');
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

    // Epic 8 (SIR-JOBD-002 / FIND-SEC-002): a manager may only patch work
    // requests belonging to a hotel in their scope claim (retired M-4).
    // Admin keeps unconditional cross-hotel access (unchanged).
    if (actor.role === 'manager') {
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
        return wrUpdated;
      });
    } else {
      updated = await this.prisma.jobRequest.update({ where: { id }, data });
    }

    await this.logAudit(actor.userId, actor.role, 'UPDATE', 'WORK_REQUEST', id, {
      from_status: wr.status,
      to_status: updated.status,
    });

    return this.toDto(updated);
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
   * This method does NOT notify anyone (PR 9.8), does not let anyone accept
   * (PR 9.9), and does not register an auto-close job (PR 9.10) — it only
   * persists the broadcast and its skill×headcount breakdown, closing
   * TREQ-002/TRULE-002's "calendar edits never emit a broadcast" clause by
   * construction: this is the *only* creation path that populates
   * skill_slots, and it is never invoked by placeOnCalendar() (PR 9.5) or by
   * the marketplace create()/update() methods above.
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
    // SIR-JOBD-002/FIND-SEC-002): a manager may only raise a broadcast for a
    // hotel in their scope claim. Admin keeps unconditional cross-hotel
    // access.
    if (actor.role === 'manager') {
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
      return { wr: created, slots: created.skill_slots };
    });

    await this.logAudit(actor.userId, actor.role, 'CREATE', 'WORK_REQUEST', wr.id, {
      hotel_id: wr.hotel_id,
      status: wr.status,
      skills: input.skills,
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

    if (actor.role === 'manager') {
      const inScope = await isHotelInScope(actor.scope ?? null, wr.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot view eligibility for this work request');
      }
    }

    const rosterWorkerIds = await listEligibleWorkerIds(wr.hotel_id);
    if (rosterWorkerIds.length === 0) {
      return {
        job_request_id: wr.id,
        hotel_id: wr.hotel_id,
        shift_date: wr.shift_date.toISOString().slice(0, 10),
        slots: wr.skill_slots.map((slot) => ({
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

    const freeWorkerIds = new Set(
      (
        await Promise.all(
          rosterWorkerIds.map(async (workerId) => ({
            workerId,
            free: await isWorkerFreeOnDay(workerId, wr.shift_date),
          }))
        )
      )
        .filter((r) => r.free)
        .map((r) => r.workerId)
    );

    const slots: SkillSlotEligibilityDto[] = wr.skill_slots.map((slot) => {
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
}

export const jobRequestService = new JobRequestService();

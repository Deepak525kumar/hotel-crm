import { OutboxSourceModule, OutboxTransport, Prisma, WorkRequest, WorkRequestStatus } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { DatabaseTransaction } from '../../lib/db.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import {
  isWorkerEligibleForHotel,
  listEligibleHotelIds,
  listEligibleWorkerIds,
} from '../../lib/roster-scope.js';
import { notificationService } from '../notifications/service.js';
import { isHotelInScope } from '../../middleware/permissions.js';
import type { UserScope } from '../../lib/jwt.js';
import {
  CreateWorkRequestInput,
  ListWorkRequestsQuery,
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

export class WorkRequestService extends BaseService {
  private toDto(wr: WorkRequest): WorkRequestDto {
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
    };
  }

  async create(
    input: CreateWorkRequestInput,
    actor: Actor
  ): Promise<WorkRequestDto> {
    const hotel = await this.prisma.hotel.findUnique({ where: { id: input.hotel_id } });
    if (!hotel || hotel.deleted_at) throw new NotFoundError('Hotel not found');

    // GD-05: per-hotel "pause new jobs" toggle (REQ-CRM-008).
    if (!hotel.accepting_jobs) {
      throw new ForbiddenError('This hotel is not currently accepting new work requests');
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

    const wr = await this.prisma.workRequest.create({
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
    const where: Prisma.WorkRequestWhereInput = {
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
      this.prisma.workRequest.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: [{ shift_date: 'desc' }, { created_at: 'desc' }],
      }),
      this.prisma.workRequest.count({ where }),
    ]);

    return { data: records.map((r) => this.toDto(r)), total };
  }

  async getById(
    id: string,
    actor: { userId: string; role: string }
  ): Promise<WorkRequestDto> {
    const wr = await this.prisma.workRequest.findUnique({ where: { id } });
    if (!wr) throw new NotFoundError('Work request not found');

    if (actor.role !== 'admin' && actor.role !== 'manager') {
      const eligible = await isWorkerEligibleForHotel(actor.userId, wr.hotel_id);
      if (!eligible) throw new ForbiddenError('Cannot access this work request');
    }

    const dto = this.toDto(wr);

    if (actor.role === 'worker' || actor.role === 'checker') {
      const app = await this.prisma.workApplication.findFirst({
        where: { work_request_id: id, worker_id: actor.userId },
        select: { id: true, status: true, applied_at: true },
        orderBy: { applied_at: 'desc' },
      });
      dto.my_application = app
        ? { id: app.id, status: app.status, created_at: app.applied_at.toISOString() }
        : null;
    }

    return dto;
  }

  async update(
    id: string,
    input: UpdateWorkRequestInput,
    actor: Actor
  ): Promise<WorkRequestDto> {
    const wr = await this.prisma.workRequest.findUnique({ where: { id } });
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

    const data: Prisma.WorkRequestUpdateInput = {};
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
    let updated: WorkRequest;
    if (isPublishing) {
      const workerIds = await listEligibleWorkerIds(wr.hotel_id);
      updated = await this.prisma.$transaction(async (tx) => {
        const wrUpdated = await tx.workRequest.update({ where: { id }, data });
        await this.enqueueRosterPublished(tx, wrUpdated, workerIds);
        return wrUpdated;
      });
    } else {
      updated = await this.prisma.workRequest.update({ where: { id }, data });
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
    wr: WorkRequest,
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
          producerService: 'WorkRequestService',
        },
        tx
      );
    }
  }
}

export const workRequestService = new WorkRequestService();

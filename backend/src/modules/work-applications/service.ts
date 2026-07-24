import {
  OutboxSourceModule,
  OutboxTransport,
  Prisma,
  WorkApplication,
  ApplicationStatus,
  AssignmentStatus,
  AttendanceStatus,
  WorkRequestStatus,
} from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { isWorkerEligibleForHotel } from '../../lib/roster-scope.js';
import { notificationService } from '../notifications/service.js';
import { isScopeAuthzEnabled } from '../../config/feature-flags.js';
import { isHotelInScope } from '../../middleware/permissions.js';
import type { UserScope } from '../../lib/jwt.js';
import {
  ApplyWorkRequestInput,
  ListApplicationsQuery,
  UpdateApplicationInput,
  WorkApplicationDto,
} from './types.js';

interface Actor {
  userId: string;
  role: string;
  scope?: UserScope | null;
}

export class WorkApplicationService extends BaseService {
  private toDto(app: WorkApplication): WorkApplicationDto {
    return {
      id: app.id,
      work_request_id: app.work_request_id,
      worker_id: app.worker_id,
      reviewed_by_id: app.reviewed_by_id,
      status: app.status,
      cover_note: app.cover_note,
      worker_rating_snapshot: app.worker_rating_snapshot,
      reviewed_at: app.reviewed_at?.toISOString() ?? null,
      rejection_reason: app.rejection_reason,
      applied_at: app.applied_at.toISOString(),
      updated_at: app.updated_at.toISOString(),
    };
  }

  async apply(
    workRequestId: string,
    input: ApplyWorkRequestInput,
    actorId: string,
    actorRole: string
  ): Promise<WorkApplicationDto> {
    const wr = await this.prisma.workRequest.findUnique({ where: { id: workRequestId } });
    if (!wr) throw new NotFoundError('Work request not found');
    if (wr.status !== WorkRequestStatus.OPEN && wr.status !== WorkRequestStatus.PARTIALLY_FILLED) {
      throw new ConflictError('Work request is not accepting applications');
    }

    // Worker must be ACTIVE on this hotel's roster
    const eligible = await isWorkerEligibleForHotel(actorId, wr.hotel_id);
    if (!eligible) throw new ForbiddenError('Worker is not on the active roster for this hotel');

    // Check for duplicate application
    const existing = await this.prisma.workApplication.findUnique({
      where: { work_request_id_worker_id: { work_request_id: workRequestId, worker_id: actorId } },
    });
    if (existing && existing.status !== ApplicationStatus.WITHDRAWN) {
      throw new ConflictError('Already applied to this work request');
    }

    // Snapshot rating at apply time
    const overallRating = await this.prisma.workerOverallRating.findUnique({
      where: { worker_id: actorId },
      select: { average_score: true },
    });

    // ADR-029 (GD-01, Epic 7 PR 7.3): the application write and the
    // APPLICATION_RECEIVED enqueue join one transaction (single commit,
    // ADR-029 §2).
    const app = await this.prisma.$transaction(async (tx) => {
      let created: WorkApplication;
      if (existing) {
        // Re-apply after withdrawal
        created = await tx.workApplication.update({
          where: { id: existing.id },
          data: {
            status: ApplicationStatus.PENDING,
            cover_note: input.cover_note ?? null,
            worker_rating_snapshot: overallRating?.average_score
              ? Number(overallRating.average_score)
              : null,
            reviewed_by_id: null,
            reviewed_at: null,
            rejection_reason: null,
          },
        });
      } else {
        created = await tx.workApplication.create({
          data: {
            work_request_id: workRequestId,
            worker_id: actorId,
            status: ApplicationStatus.PENDING,
            cover_note: input.cover_note ?? null,
            worker_rating_snapshot: overallRating?.average_score
              ? Number(overallRating.average_score)
              : null,
          },
        });
      }

      await notificationService.enqueue(
        {
          recipientId: wr.created_by_id,
          type: 'APPLICATION_RECEIVED',
          title: 'New Application Received',
          message: 'A worker has submitted an application for your work request.',
          data: { application_id: created.id, work_request_id: workRequestId },
          hotelId: wr.hotel_id,
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.WORK_APPLICATIONS,
          producerService: 'WorkApplicationService',
        },
        tx
      );

      return created;
    });

    await this.logAudit(actorId, actorRole, 'APPLY', 'WORK_APPLICATION', app.id, {
      work_request_id: workRequestId,
    });

    return this.toDto(app);
  }

  async list(
    workRequestId: string,
    query: ListApplicationsQuery,
    actor: { userId: string; role: string }
  ): Promise<{ data: WorkApplicationDto[]; total: number }> {
    const wr = await this.prisma.workRequest.findUnique({ where: { id: workRequestId } });
    if (!wr) throw new NotFoundError('Work request not found');

    // Workers can only see their own application
    if (actor.role !== 'admin' && actor.role !== 'manager') {
      const app = await this.prisma.workApplication.findUnique({
        where: {
          work_request_id_worker_id: { work_request_id: workRequestId, worker_id: actor.userId },
        },
      });
      if (!app) return { data: [], total: 0 };
      return { data: [this.toDto(app)], total: 1 };
    }

    const where: Prisma.WorkApplicationWhereInput = {
      work_request_id: workRequestId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.workApplication.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { applied_at: 'desc' },
      }),
      this.prisma.workApplication.count({ where }),
    ]);

    return { data: records.map((r) => this.toDto(r)), total };
  }

  async update(
    workRequestId: string,
    applicationId: string,
    input: UpdateApplicationInput,
    actor: Actor
  ): Promise<WorkApplicationDto> {
    const app = await this.prisma.workApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app || app.work_request_id !== workRequestId) {
      throw new NotFoundError('Application not found');
    }
    if (app.status !== ApplicationStatus.PENDING) {
      throw new ConflictError(`Application is already ${app.status}`);
    }

    const isWorker = actor.role !== 'admin' && actor.role !== 'manager';

    if (isWorker) {
      // Workers may only withdraw their own application
      if (app.worker_id !== actor.userId) throw new ForbiddenError('Cannot modify another worker\'s application');
      if (input.status !== 'WITHDRAWN') throw new ForbiddenError('Workers may only withdraw applications');
    }

    if (input.status === 'ACCEPTED') {
      return this.approve(app, actor);
    }

    // Epic 8 (SIR-JOBD-002 / FIND-SEC-003): a manager may only reject
    // applications belonging to a work request in their scope claim when
    // scope-authz is enabled. Admin keeps unconditional cross-hotel access
    // (unchanged); workers only reach here via WITHDRAWN and are unaffected.
    if (isScopeAuthzEnabled() && actor.role === 'manager') {
      const wr = await this.prisma.workRequest.findUnique({ where: { id: workRequestId } });
      if (!wr) throw new NotFoundError('Work request not found');
      const inScope = await isHotelInScope(actor.scope ?? null, wr.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot modify this application');
      }
    }

    const data: Prisma.WorkApplicationUpdateInput = {
      status: input.status as ApplicationStatus,
      reviewed_at: new Date(),
      reviewed_by: isWorker ? { disconnect: true } : { connect: { id: actor.userId } },
      ...(input.status === 'REJECTED' ? { rejection_reason: input.rejection_reason ?? null } : {}),
    };

    // ADR-029 (GD-01, Epic 7 PR 7.3): single commit for the status write and
    // (on rejection) the APPLICATION_REJECTED enqueue.
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.workApplication.update({ where: { id: applicationId }, data });
      if (input.status === 'REJECTED') {
        await notificationService.enqueue(
          {
            recipientId: app.worker_id,
            type: 'APPLICATION_REJECTED',
            title: 'Application Rejected',
            message: 'Your application has been rejected.',
            data: {
              application_id: applicationId,
              work_request_id: workRequestId,
              rejection_reason: input.rejection_reason ?? null,
            },
            transports: [OutboxTransport.PUSH],
            sourceModule: OutboxSourceModule.WORK_APPLICATIONS,
            producerService: 'WorkApplicationService',
          },
          tx
        );
      }
      return u;
    });

    await this.logAudit(actor.userId, actor.role, `APPLICATION_${input.status}`, 'WORK_APPLICATION', applicationId, {
      work_request_id: workRequestId,
      worker_id: app.worker_id,
    });

    return this.toDto(updated);
  }

  // Approve path — 7-step transaction
  private async approve(
    app: WorkApplication,
    actor: Actor
  ): Promise<WorkApplicationDto> {
    const wr = await this.prisma.workRequest.findUnique({ where: { id: app.work_request_id } });
    if (!wr) throw new NotFoundError('Work request not found');

    // Epic 8 (SIR-JOBD-002 / FIND-SEC-003): a manager may only approve
    // applications for work requests in their scope claim when scope-authz is
    // enabled. Admin keeps unconditional cross-hotel access (unchanged).
    if (isScopeAuthzEnabled() && actor.role === 'manager') {
      const inScope = await isHotelInScope(actor.scope ?? null, wr.hotel_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot approve applications for this hotel');
      }
    }

    if (wr.status !== WorkRequestStatus.OPEN && wr.status !== WorkRequestStatus.PARTIALLY_FILLED) {
      throw new ConflictError('Work request is no longer accepting approvals');
    }

    const txResult = await this.prisma.$transaction(async (tx) => {
      // Optimistic-lock slot claim
      const claimed = await tx.workRequest.updateMany({
        where: {
          id: wr.id,
          version: wr.version,
          workers_confirmed: { lt: wr.workers_needed },
        },
        data: {
          workers_confirmed: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) throw new ConflictError('No available slots or concurrent update conflict');

      // Accept application
      const acceptedApp = await tx.workApplication.update({
        where: { id: app.id },
        data: {
          status: ApplicationStatus.ACCEPTED,
          reviewed_by_id: actor.userId,
          reviewed_at: new Date(),
        },
      });

      // Create assignment (mandatory application_id link — SP-3)
      const assignment = await tx.workerAssignment.create({
        data: {
          work_request_id: wr.id,
          worker_id: app.worker_id,
          hotel_id: wr.hotel_id,
          assigned_by_id: actor.userId,
          application_id: app.id,
          status: AssignmentStatus.CONFIRMED,
          confirmed_at: new Date(),
        },
      });

      // Pre-create Attendance record (EXPECTED) for idempotent check-in
      await tx.attendance.create({
        data: {
          assignment_id: assignment.id,
          worker_id: app.worker_id,
          hotel_id: wr.hotel_id,
          status: AttendanceStatus.EXPECTED,
          expected_start: wr.shift_date
            ? new Date(
                `${wr.shift_date.toISOString().slice(0, 10)}T${wr.shift_start_time}:00.000Z`
              )
            : null,
          expected_end: wr.shift_date
            ? new Date(
                `${wr.shift_date.toISOString().slice(0, 10)}T${wr.shift_end_time}:00.000Z`
              )
            : null,
        },
      });

      // Refresh WorkRequest fill status
      const freshWr = await tx.workRequest.findUnique({ where: { id: wr.id } });
      if (freshWr && freshWr.workers_confirmed >= freshWr.workers_needed) {
        await tx.workRequest.update({
          where: { id: wr.id },
          data: { status: WorkRequestStatus.FILLED, filled_at: new Date() },
        });
      } else {
        await tx.workRequest.update({
          where: { id: wr.id },
          data: { status: WorkRequestStatus.PARTIALLY_FILLED },
        });
      }

      // ADR-029 (GD-01, Epic 7 PR 7.3): both post-approval notifications join
      // this same transaction — single commit alongside the slot claim,
      // application accept, assignment create, and attendance pre-create.
      await notificationService.enqueue(
        {
          recipientId: app.worker_id,
          type: 'APPLICATION_ACCEPTED',
          title: 'Application Approved',
          message: 'Your application has been approved.',
          data: { application_id: app.id, work_request_id: app.work_request_id },
          hotelId: wr.hotel_id,
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.WORK_APPLICATIONS,
          producerService: 'WorkApplicationService',
        },
        tx
      );
      await notificationService.enqueue(
        {
          recipientId: app.worker_id,
          type: 'ASSIGNMENT_CONFIRMED',
          title: 'Assignment Confirmed',
          message: 'You have been assigned to a shift.',
          data: { assignment_id: assignment.id, work_request_id: app.work_request_id },
          hotelId: wr.hotel_id,
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.WORK_APPLICATIONS,
          producerService: 'WorkApplicationService',
        },
        tx
      );

      return { acceptedApp, assignment };
    });

    const { acceptedApp } = txResult;

    await this.logAudit(actor.userId, actor.role, 'APPLICATION_ACCEPTED', 'WORK_APPLICATION', app.id, {
      work_request_id: app.work_request_id,
      worker_id: app.worker_id,
    });

    return this.toDto(acceptedApp);
  }
}

export const workApplicationService = new WorkApplicationService();

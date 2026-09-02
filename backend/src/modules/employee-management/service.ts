import {
  AssignmentStatus,
  ContractStatus,
  DeactivationReason,
  EmploymentStatus,
  EmploymentRecord,
  OutboxSourceModule,
  OutboxTransport,
  NotificationType,
  Prisma,
  SkillTag,
  UserRole,
} from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import type { DatabaseTransaction } from '../../lib/db.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { isScopedManagerRole, isWorkerInGroupScope } from '../../lib/scope.js';
import { canCreateRole, createRoleDenialMessage } from '../../lib/role-hierarchy.js';
import type { AuthContext } from '../../lib/types.js';
import { bumpTokenGeneration } from '../auth/service.js';
import { ACTIVE_ASSIGNMENT_STATUSES, assignmentService } from '../assignments/service.js';
import { documentService } from '../documents/service.js';
// 2026-08-13 contract feature: createEmployee() below auto-generates the
// single default contract the moment an application record is created (see
// that method's own comment). HR already depends on employee-management
// (hr/service.ts imports employeeManagementService) -- this is the one
// call site going the other direction; both modules' usage is inside
// function bodies, not at module-eval time, so the resulting import cycle
// resolves safely under Node ESM.
import { hrService, isContractValid } from '../hr/service.js';
// ADR-065 onboarding notifications (2026-08-13): submitted -> reviewer,
// approved/rejected -> applicant. enqueue() writes the in-app notification
// AND the outbox event, so PUSH delivery follows once credentials exist.
import { notificationService } from '../notifications/service.js';
import {
  assertTransition,
  ASSESSMENT_BASIS,
  DEFAULT_HISTORY_MONTHS,
  DEFAULT_PAGE_SIZE,
  getRetentionTiers,
  MAX_HISTORY_MONTHS,
  MAX_HISTORY_SOURCES,
  MAX_PAGE_SIZE,
} from './constants.js';
import type {
  CreateEmployeeRequest,
  ProfileHistoryQuery,
  SpecialCategoryField,
} from './types.js';

// General-profile view of an employment record: everything except the two
// special-category fields (REQ-EMP-007 / RULE-EMP-09; G4 FIND-002 — the
// general profile serializer must be physically unreachable from the
// special-category fields).
export function toGeneralProfile(record: EmploymentRecord): Omit<EmploymentRecord, 'konfession' | 'disability_status'> {
  const profile: any = { ...record };
  delete profile.konfession;
  delete profile.disability_status;
  if (profile.user && typeof profile.user === 'object') {
    delete profile.user.password_hash;
  }
  return profile as Omit<EmploymentRecord, 'konfession' | 'disability_status'>;
}

// Single restricted-field accessor for IF-EMP-GetSpecialCategory — returns
// only the one requested field, never the general profile shape.
export function toSpecialCategory(
  record: EmploymentRecord,
  field: SpecialCategoryField
): { employee_id: string; field: SpecialCategoryField; value: string | null } {
  return { employee_id: record.employee_id, field, value: record[field] };
}

export class EmployeeManagementService extends BaseService {
  // ── Create / import (IF-EMP-CreateEmployee, IF-EMP-...bulk) ────────────────

  // OD-EMP-08 (Open decision): the permission holder for staff creation
  // beyond Admin is unresolved ("other importing roles [OPEN]" — Interfaces
  // table; permission matrix marks Manager/Regional-Manager bulk-import as
  // `[OPEN]`). Conservatively restricted to Admin for both manual and bulk
  // creation until that decision resolves.
  async createEmployee(actor: AuthContext, data: CreateEmployeeRequest) {
    // Determine the target user's role to apply creation logic
    const targetUser = await this.prisma.user.findUnique({ where: { id: data.user_id } });
    if (!targetUser) {
      throw new ConflictError('User not found');
    }

    // RULE A (project-owner decision, 2026-08-12): create is 1-level-down
    // ONLY. This is the primary authorization boundary for creation and is
    // checked FIRST, before any per-role scoping below — the route's
    // requireRole() list cannot express it (it says nothing about the role
    // being created) and previously nothing did, which is the hole this
    // closes. See lib/role-hierarchy.ts for the mapping and the governance
    // conflict it records (ADR-065 / ADR-030 §3 C-15 amendment owed).
    //
    // The per-role blocks that follow are RETAINED: they enforce a different
    // question (which GROUP/HOTEL the created record is targeted at), which
    // RULE A does not answer. Their own role-set checks are now redundant
    // with this one but are deliberately left in place as defense-in-depth.
    if (!canCreateRole(actor.role, targetUser.role)) {
      throw new ForbiddenError(createRoleDenialMessage(actor.role, targetUser.role));
    }

    // Role-based creation guards
    if (actor.role === 'admin') {
      // Admin can create for anyone.
      // If Admin creates a Manager application, target_hotel_group_id is required.
      if (targetUser.role === 'MANAGER' && !data.target_hotel_group_id) {
        throw new ConflictError('Admin must explicitly provide a target_hotel_group_id when creating a Manager application');
      }
    } else if (actor.role === 'regional_manager') {
      // Regional Manager can only create Workers, Checkers, and Managers
      if (!['WORKER', 'CHECKER', 'MANAGER'].includes(targetUser.role)) {
        throw new ForbiddenError('Regional Manager may only create applications for Worker, Checker, and Manager roles');
      }
      if (targetUser.role === 'MANAGER') {
        const rmGroup = actor.scope?.type === 'hotel_group' ? actor.scope.hotel_group_id : undefined;
        if (!rmGroup) {
          throw new ForbiddenError('Regional Manager must have a scoped hotel_group_id to create a Manager application');
        }
        if (data.target_hotel_group_id && data.target_hotel_group_id !== rmGroup) {
          throw new ConflictError('Regional Manager cannot create a Manager application targeting a different group');
        }
        data.target_hotel_group_id = rmGroup;
      }
    } else if (actor.role === 'manager') {
      // Manager can only create Workers and Checkers
      if (!['WORKER', 'CHECKER'].includes(targetUser.role)) {
        throw new ForbiddenError('Manager may only create applications for Worker and Checker roles');
      }
      const mgrHotel = actor.scope?.type === 'hotel' ? actor.scope.hotel_id : undefined;
      if (!mgrHotel) {
        throw new ForbiddenError('Manager must have a scoped hotel_id to create an application');
      }
      if (data.target_primary_hotel_id && data.target_primary_hotel_id !== mgrHotel) {
        throw new ConflictError('Manager cannot create an application targeting a different hotel');
      }
      data.target_primary_hotel_id = mgrHotel;
      
      // Auto-populate target_hotel_group_id from the Manager's hotel if not already fetched
      const mgrHotelRecord = await this.prisma.hotel.findUnique({ where: { id: mgrHotel } });
      if (mgrHotelRecord && mgrHotelRecord.hotel_group_id) {
        data.target_hotel_group_id = mgrHotelRecord.hotel_group_id;
      }
    } else {
      throw new ForbiddenError('Only Admin, Regional Manager, and Manager may create employment records');
    }

    if (data.skills) {
      this.assertValidSkills(data.skills);
    }

    const [existingByUser, existingByEmployeeId] = await Promise.all([
      this.prisma.employmentRecord.findUnique({ where: { user_id: data.user_id } }),
      this.prisma.employmentRecord.findUnique({ where: { employee_id: data.employee_id } }),
    ]);
    if (existingByUser || existingByEmployeeId) {
      throw new ConflictError('An employment record already exists for this user or employee ID');
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const createdRecord = await tx.employmentRecord.create({
        data: {
          user_id: data.user_id,
          employee_id: data.employee_id,
          job_title: data.job_title,
          start_date: data.start_date,
          // 2026-08-06 rework: INACTIVE/UNDER_REVIEW collapsed into PENDING;
          // "submitted for review" is now the submitted_for_review_at sub-state
          // (schema.prisma EmploymentStatus comment), not a separate status. A
          // freshly-created record is PENDING with submitted_for_review_at null,
          // exactly what the old INACTIVE meant.
          status: EmploymentStatus.PENDING,
          work_permit_required: data.work_permit_required ?? false,
          target_hotel_group_id: data.target_hotel_group_id || null,
          target_primary_hotel_id: data.target_primary_hotel_id || null,
          skills: data.skills ?? [],
          personal_data: data.personal_data
            ? (data.personal_data as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          // 2026-08-13 contract feature: mandatory at creation time
          // (CreateEmployeeSchema), carried by the creating actor's choice of
          // full-time vs part-time for the person they are onboarding.
          employment_type: data.employment_type,
          // 2026-08-13 review-routing fix: records who created this
          // application, so the review queue can route to the creator's own
          // superior (getReviewQueue below) instead of the applicant's
          // target scope.
          created_by_id: actor.userId,
        },
      });

      await this.logAudit(actor.userId, actor.role, 'employee.create', 'EMPLOYMENT_RECORD', createdRecord.id, {
        employee_id: createdRecord.employee_id,
      }, undefined, undefined, undefined, tx);

      return createdRecord;
    });

    // 2026-08-13 contract feature: auto-generate the single default contract
    // for this applicant. Deliberately outside the record-creation
    // transaction above -- hrService.generateDefaultContract() is a
    // best-effort side effect (mirrors HR's own notifyResponsibleManager()
    // posture elsewhere in this codebase), not a condition of the
    // application existing; a failure here must not roll back the
    // just-committed EmploymentRecord. submitForReview() below re-checks a
    // contract exists before allowing submission, so a failure surfaces
    // there rather than being silently lost.
    try {
      await hrService.generateDefaultContract(
        data.user_id,
        data.job_title,
        record.start_date,
        record.employment_type
      );
    } catch (error) {
      logger.error('employee_create_default_contract_failed', {
        userId: data.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return toGeneralProfile(record);
  }

  // REQ-EMP-006 / RULE-EMP-10: bulk import routes each row through the same
  // path as manual creation, starting Inactive. Per-row isolation: a failing
  // row (validation or duplicate) does not affect any other row. Row-level
  // duplicate/invalid-row semantics beyond isolation remain OPEN (OD-EMP-08).

  async updateEmployee(actor: AuthContext, employeeId: string, data: { job_title?: string; employment_type?: any; skills?: SkillTag[] }) {
    // 1. Enforce jurisdiction
    const record = await this.prisma.employmentRecord.findUnique({ where: { employee_id: employeeId } });
    if (!record) throw new NotFoundError('Employment record not found');
    // 2026-08-26: was missing `allowUnassignedGroup: true` (present on
    // submit-for-review just below). hotel_group_id stays null until
    // approval (ADR-065 Decision 2), so isWorkerInGroupScope() can never
    // succeed for a not-yet-approved applicant -- exactly the case
    // WorkerOnboardingCard's skills row is deliberately shown for (a
    // worker's first pass through onboarding). Editing skills for such an
    // applicant 403'd every time; same bug class already fixed for
    // contract-status/contract-download/documents completeness.
    await this.assertLifecycleAuthority(actor, record, 'update', { allowUnassignedGroup: true });

    // 2. Validate skills if provided
    if (data.skills) {
      this.assertValidSkills(data.skills);
    }

    // 3. Update the record
    const updated = await this.prisma.employmentRecord.update({
      where: { employee_id: employeeId },
      data: {
        ...(data.job_title ? { job_title: data.job_title } : {}),
        ...(data.employment_type ? { employment_type: data.employment_type } : {}),
        ...(data.skills ? { skills: data.skills } : {}),
      }
    });

    // 4. Audit logging
    await this.logAudit(
      actor.userId,
      actor.role,
      'MODIFY',
      'EMPLOYEE',
      employeeId,
      { action: 'update_employee_details', updated_fields: Object.keys(data) }
    );

    return updated;
  }

  async bulkImport(actor: AuthContext, rows: CreateEmployeeRequest[]) {
    if (actor.role !== 'admin') {
      throw new ForbiddenError('Only Admin may bulk-import employment records');
    }

    const created: Array<Omit<EmploymentRecord, 'konfession' | 'disability_status'>> = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      try {
        // Per-row isolation (RULE-EMP-10): sequential, independently-caught
        // creation so one row's failure cannot corrupt or block another's.
        const result = await this.createEmployee(actor, row);
        created.push(result);
      } catch (err) {
        errors.push({ index, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return { created, errors };
  }

  // ── Profile / skills / blocklist reads ──────────────────────────────────

  // IF-EMP-GetProfileHistory / v0 (REQ-EMP-004, REQ-EMP-013). Excludes
  // special-category fields (REQ-EMP-007). Pagination/date-range/fan-out
  // bounds are PROVISIONAL (OD-EMP-16 / PERF-EMP-002) — see constants.ts.
  async getProfileHistory(actor: AuthContext, employeeId: string, filters: ProfileHistoryQuery) {
    const record = await this.findRecordOrThrow(employeeId);
    await this.assertVisibility(actor, record);

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const months = Math.min(filters.months ?? DEFAULT_HISTORY_MONTHS, MAX_HISTORY_MONTHS);

    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setMonth(defaultStart.getMonth() - months);
    const rangeStart = filters.from_date ?? defaultStart;
    const rangeEnd = filters.to_date ?? now;

    // PROVISIONAL (OD-EMP-16 / PERF-EMP-002): a fixed, capped list of
    // referenced-data sources rather than an open-ended multi-module
    // aggregation, so the synchronous fan-out per request stays bounded.
    const sourceQueries: Array<() => Promise<unknown>> = [
      () =>
        this.prisma.attendance.findMany({
          where: { worker_id: record.user_id, created_at: { gte: rangeStart, lte: rangeEnd } },
          take: limit,
          skip: (page - 1) * limit,
          orderBy: { created_at: 'desc' },
        }),
      () =>
        // The worker's inspection history. Reads checks since the Rating merge
        // (2026-08-29); `worker_id` is a real column on QualityVerification,
        // so this stays the same shape and stays index-backed.
        this.prisma.qualityVerification.findMany({
          where: { worker_id: record.user_id, created_at: { gte: rangeStart, lte: rangeEnd } },
          take: limit,
          skip: (page - 1) * limit,
          orderBy: { created_at: 'desc' },
        }),
    ];
    const bounded = sourceQueries.slice(0, MAX_HISTORY_SOURCES);
    const [attendance, ratings] = await Promise.all(bounded.map((run) => run()));

    return {
      profile: toGeneralProfile(record),
      attendance: attendance ?? [],
      ratings: ratings ?? [],
      filters: { page, limit, months, from_date: rangeStart, to_date: rangeEnd },
    };
  }

  // IF-EMP-GetSkills / v0 (REQ-EMP-003).
  async getSkills(actor: AuthContext, employeeId: string) {
    const record = await this.findRecordOrThrow(employeeId);
    await this.assertVisibility(actor, record);
    return {
      employee_id: record.employee_id,
      skills: record.skills.map((tag) => ({ tag, assessment_basis: ASSESSMENT_BASIS[tag] })),
    };
  }

  // IF-EMP-GetBlocklist / v0 (REQ-EMP-005). The hotel-scoped route already
  // enforces checkHotelAccess(); no additional scope check here.
  async getBlocklist(_actor: AuthContext, filters: { hotelId?: string; employeeId?: string; page?: number; limit?: number }) {
    const where: Prisma.EmployeeBlocklistEntryWhereInput = {};
    if (filters.hotelId) where.hotel_id = filters.hotelId;
    if (filters.employeeId) {
      const record = await this.findRecordOrThrow(filters.employeeId);
      where.employment_record_id = record.id;
    }
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const [entries, total] = await Promise.all([
      this.prisma.employeeBlocklistEntry.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.employeeBlocklistEntry.count({ where }),
    ]);
    return { data: entries, total };
  }

  // IF-EMP-SetBlocklist / v0 (REQ-EMP-005 / RULE-EMP-07): reason is required.
  // The hotel-scoped route already enforces checkHotelAccess(); no additional
  // scope check here.
  async setBlocklist(actor: AuthContext, input: { hotelId: string; employeeId: string; reason: string }) {
    if (!input.reason || !input.reason.trim()) {
      throw new ValidationError('reason is required', [
        { field: 'reason', message: 'Reason must not be blank' },
      ]);
    }

    const record = await this.findRecordOrThrow(input.employeeId);
    const entry = await this.prisma.employeeBlocklistEntry.create({
      data: {
        hotel_id: input.hotelId,
        employment_record_id: record.id,
        reason: input.reason.trim(),
        created_by_id: actor.userId,
      },
    });

    await this.logAudit(actor.userId, actor.role, 'employee.blocklist', 'EMPLOYEE_BLOCKLIST_ENTRY', entry.id, {
      hotel_id: input.hotelId,
      employment_record_id: record.id,
    });
    return entry;
  }

  // IF-EMP-RemoveBlocklist / v0 (REQ-EMP-005 / RULE-EMP-07 rework,
  // 2026-08-06): blocklist entries previously had no removal path at all —
  // once created, an entry was permanent even after the underlying reason
  // no longer applied.
  //
  // IDOR FIX (found by adversarial review, 2026-08-06): this method used to
  // take only `entryId` on the premise that it was "the same authorization
  // shape as setBlocklist()" — it is not. setBlocklist() takes hotelId from
  // the checkHotelAccess()-validated path and WRITES it into the row, so its
  // effect is structurally confined to the hotel the route validated.
  // removeBlocklist() addresses a row by opaque id, so the path's hotel_id
  // was being validated by the route middleware and then silently ignored
  // by the service -- a manager scoped to hotel h1 could delete an entry
  // belonging to hotel h2 by simply knowing/guessing its id, fully bypassing
  // checkHotelAccess(). Fixed by requiring the entry's own hotel_id to match
  // the route's hotelId, 404ing on mismatch (not 403, so a caller outside
  // this hotel cannot use the response to confirm the id exists elsewhere).
  async removeBlocklist(actor: AuthContext, hotelId: string, entryId: string) {
    const entry = await this.prisma.employeeBlocklistEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.hotel_id !== hotelId) {
      throw new NotFoundError('Blocklist entry not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeBlocklistEntry.delete({ where: { id: entryId } });

      await this.logAudit(actor.userId, actor.role, 'employee.blocklist.remove', 'EMPLOYEE_BLOCKLIST_ENTRY', entryId, {
        hotel_id: entry.hotel_id,
        employment_record_id: entry.employment_record_id,
      }, undefined, undefined, undefined, tx);
    });
  }

  // ── Special category / export / deactivate ──────────────────────────────

  // IF-EMP-GetSpecialCategory / v0 (REQ-EMP-007 / RULE-EMP-09, G4 FIND-002
  // High). Konfession's additional "payslip-request processor" audience
  // (CRR §27) is deferred: the confirmed UserRole enum has no such role
  // (WORKER/CHECKER/MANAGER/ADMIN only — see spec Dependencies "HR
  // (Payslips, ADR-014)" row), so this restricts to Admin only for both
  // fields until that audience gets a concrete role/permission to check.
  // The audit write is synchronous in this request path on both the deny and
  // allow branches (FIND-002's "not best-effort logging" requirement).
  async getSpecialCategory(actor: AuthContext, employeeId: string, field: SpecialCategoryField) {
    const record = await this.findRecordOrThrow(employeeId);

    if (actor.role !== 'admin') {
      await this.logAudit(
        actor.userId,
        actor.role,
        'employee.special_category.denied',
        'EMPLOYMENT_RECORD',
        record.id,
        { field }
      );
      throw new ForbiddenError('Special-category data is restricted to Admin');
    }

    await this.logAudit(
      actor.userId,
      actor.role,
      'employee.special_category.access',
      'EMPLOYMENT_RECORD',
      record.id,
      { field }
    );
    return toSpecialCategory(record, field);
  }

  // IF-EMP-ExportEmployeeData / v0 (REQ-EMP-009): subject-rights fulfilment.
  // Admin-only; may include special-category fields since this is itself an
  // admin-authorized action, distinct from IF-EMP-GetSpecialCategory's
  // per-viewer restriction. Still audited as an important record action
  // (REQ-EMP-010).
  async exportEmployeeData(actor: AuthContext, employeeId: string) {
    if (actor.role !== 'admin') {
      throw new ForbiddenError('Only Admin may export employee data');
    }
    const record = await this.findRecordOrThrow(employeeId);
    await this.logAudit(actor.userId, actor.role, 'employee.export', 'EMPLOYMENT_RECORD', record.id, {});
    return record;
  }

  // ── Lifecycle transitions (REQ-EMP-002 rework, 2026-08-06) ──────────────
  //
  // Every EmploymentStatus write on this platform goes through
  // applyTransition() below — no other method here, and no other module, may
  // update EmploymentRecord.status or employment_cycle directly (stated as an
  // invariant on the EmploymentStatusHistory model in schema.prisma). That is
  // what makes EmploymentStatusHistory a complete, append-only log rather
  // than a best-effort one: the status write and its history row are the same
  // transaction, so a transition can never commit unlogged and a log row can
  // never describe a transition that didn't commit.

  /**
   * The single status-write seam (see the section note above).
   *
   * Takes the caller's transaction client rather than opening its own: every
   * caller below already needs to join other writes to the same commit (the
   * approval group connect, the User soft-delete + token_generation bump),
   * and a helper that opened its own transaction could not be composed into
   * those without a nested-transaction workaround. `DatabaseTransaction` is
   * the repository-owned alias (lib/db.ts, ADR-029 GD-01), not
   * Prisma.TransactionClient directly.
   *
   * employment_cycle increments on DELETED -> PENDING only — a rehire after
   * the person left — and is carried forward unchanged on every other edge
   * (schema.prisma EmploymentRecord.employment_cycle). The history row records
   * the cycle the transition occurred *within*, so the incrementing edge's own
   * row carries the NEW cycle: that row is the boundary marker cycle N starts
   * at, which is exactly how schema.prisma defines a cycle interval ("cycle N
   * spans from the DELETED -> PENDING row bearing employment_cycle = N to the
   * next such row, or to now").
   */
  private async applyTransition(
    tx: DatabaseTransaction,
    record: EmploymentRecord,
    toStatus: EmploymentStatus,
    opts: {
      reason?: string | null;
      actorUserId: string | null;
      data?: Prisma.EmploymentRecordUpdateInput;
      /**
       * Removing a never-approved APPLICATION, which is not an employment
       * transition at all (delete() only -- see its own comment).
       *
       * ALLOWED_TRANSITIONS deliberately has no PENDING -> DELETED edge, and
       * that stays true: it is what stops deactivateForContractLapse() (which
       * also targets DELETED) from quietly disposing of a pending applicant
       * when their contract lapses, and two tests pin it. But delete() itself
       * carries an explicit "if the record is PENDING, a manager may delete
       * it" branch, which that same missing edge made unreachable -- so
       * nobody, admin included, could remove a mistyped applicant.
       *
       * Narrow opt-out rather than a wider table so exactly one caller gains
       * the ability, and the general rule keeps protecting every other one.
       */
      allowPendingApplicationRemoval?: boolean;
    }
  ): Promise<EmploymentRecord> {
    const isPendingApplicationRemoval =
      opts.allowPendingApplicationRemoval === true &&
      record.status === EmploymentStatus.PENDING &&
      toStatus === EmploymentStatus.DELETED;
    if (!isPendingApplicationRemoval) {
      assertTransition(record.status, toStatus);
    }

    // A new engagement cycle starts on either return path -> PENDING: a full
    // rehire (DELETED -> PENDING, via restore()) or a re-onboarding after a
    // pause whose contract no longer stands (DEACTIVATED -> PENDING, via
    // triggerReonboarding()). Both must bump employment_cycle for the same
    // reason: submitForReview()'s document-gate skip and the review queue's
    // "reonboarding" labeling are driven entirely by `employment_cycle > 1`
    // (schema.prisma's own comment: a PENDING row's employment_cycle marks
    // the start of that cycle). Leaving DEACTIVATED -> PENDING out of this
    // check -- as an earlier version of this method did -- silently forced a
    // re-onboarding worker back through the full document-completeness gate
    // the feature exists to skip, since isReonboarding read employment_cycle
    // === 1 for them.
    const isNewCycle =
      (record.status === EmploymentStatus.DELETED && toStatus === EmploymentStatus.PENDING) ||
      (record.status === EmploymentStatus.DEACTIVATED && toStatus === EmploymentStatus.PENDING);
    const nextCycle = isNewCycle ? record.employment_cycle + 1 : record.employment_cycle;

    try {
      const updated = await tx.employmentRecord.update({
        where: { id: record.id, version: record.version },
        data: {
          ...(opts.data ?? {}),
          status: toStatus,
          ...(isNewCycle ? { employment_cycle: nextCycle } : {}),
          version: { increment: 1 },
        },
        include: { 
          user: {
            select: {
              id: true,
              role: true,
            }
          }
        },
      });
      
      await tx.employmentStatusHistory.create({
        data: {
          employment_record_id: record.id,
          from_status: record.status,
          to_status: toStatus,
          reason: opts.reason ?? null,
          actor_user_id: opts.actorUserId,
          employment_cycle: nextCycle,
        },
      });

      return updated;
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new ConflictError('Record has been modified by another process. Please refresh and try again.');
      }
      throw error;
    }

  }

  /**
   * PENDING -> PENDING: onboarding submitted for review.
   *
   * Not a status change — submitted_for_review_at is a sub-state of PENDING
   * (schema.prisma), so this deliberately does NOT call applyTransition():
   * PENDING -> PENDING is not in ALLOWED_TRANSITIONS and must not be, or
   * every other same-state write would become legal too.
   *
   * Decision: no EmploymentStatusHistory row is written here. That table's
   * stated contract is one row per *status* transition (schema.prisma), and
   * it is the source of truth for employment-cycle boundaries — inserting
   * from_status == to_status rows for a non-transition would make every
   * consumer that reads it filter them back out, and the audit need is
   * already met by both the audit log entry below and the
   * submitted_for_review_at timestamp itself, which is durable on the record.
   */
  async submitForReview(actor: AuthContext, employeeId: string) {
    const record = await this.findRecordOrThrow(employeeId);
    await this.assertLifecycleAuthority(actor, record, 'submit an employee for review', {
      allowUnassignedGroup: true,
    });

    if (record.status !== EmploymentStatus.PENDING && record.status !== EmploymentStatus.REJECTED) {
      throw new ConflictError('Only a Pending or Rejected employment record may be submitted for review');
    }

    // RE-ONBOARDING (owner decision, 2026-08-13, REVISED after end-to-end
    // review): a returning employee (employment_cycle > 1, i.e. this record
    // went DELETED -> PENDING via restore()) re-onboards on the CONTRACT
    // ALONE. Their profile and documents are deliberately preserved across
    // cycles (WorkerDocument rows survive delete()/restore()), so the only
    // question a re-engagement raises is "is this person's contract still
    // valid, and if not, have they signed the new one".
    //
    // This supersedes the earlier decision to re-run the document-completeness
    // gate for returning employees "in case a document was deleted between
    // cycles". That gate blocked re-onboarding on paperwork the system was
    // explicitly designed not to ask for twice; the owner ruled the preserved
    // record is the point. Documents remain visible to the reviewer, who can
    // still reject if something is genuinely missing.
    const isReonboarding = record.employment_cycle > 1;

    // GATE: All required documents must be present before a FIRST-TIME
    // onboarding can be submitted for review. ADR-065 §6 item 8: work permit
    // requirement is explicitly driven by the record's work_permit_required
    // flag, set at creation time, rather than inferred from nationality.
    if (!isReonboarding) {
      const completeness = await documentService.getDocumentCompleteness(
        record.user_id,
        record.work_permit_required,
      );
      if (!completeness.is_complete) {
        throw new ConflictError(
          `Cannot submit for review: required documents are missing (${completeness.missing_categories.join(', ')}). Please upload all required documents first.`,
        );
      }
    }

    // GATE (owner decision, 2026-08-13): the SIGNED contract is mandatory to
    // send an application for review -- not merely a generated draft.
    //
    // This closes audit findings #3/#4: submission previously required only
    // that a Contract ROW existed, so applications landed in the reviewer's
    // queue that the reviewer could not action, because approve() separately
    // requires a valid (signed and confirmed) contract. Managers saw a
    // "submitted" application and had nothing to do with it.
    //
    // The gate is "the applicant uploaded their signed scan", NOT "a manager
    // confirmed it". That distinction is what keeps this satisfiable: only a
    // manager may confirm a contract (PENDING -> ACTIVE, RULE-HR-03), so
    // requiring CONFIRMATION here would deadlock -- the applicant could never
    // meet a gate only someone else can clear, and re-onboarding issues its
    // contract during this very call. Manager confirmation remains required,
    // one step later, at approve().
    const contract = await this.ensureValidContract(record);
    if (!contract) {
      throw new ConflictError(
        'Cannot submit for review: no contract has been generated for this application yet. Contact an administrator.',
      );
    }

    // Already-valid contract (a returning employee whose contract still
    // stands) needs no fresh signature -- there is nothing to re-sign.
    if (!isContractValid(contract)) {
      const signedScan = await this.prisma.workerDocument.findFirst({
        where: { worker_id: record.user_id, category: 'CONTRACT_SCAN' },
        orderBy: { created_at: 'desc' },
        select: { id: true, created_at: true },
      });
      // Must post-date the contract it purports to sign: a scan uploaded
      // against a PREVIOUS contract says nothing about the current one, which
      // is exactly the re-onboarding case where a fresh contract was just
      // issued (finding #4).
      if (!signedScan || signedScan.created_at < contract.created_at) {
        throw new ConflictError(
          signedScan
            ? 'Cannot submit for review: a new contract has been issued. Please download, sign and upload the current contract.'
            : 'Cannot submit for review: please download your contract, sign it, and upload the signed copy first.',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      let transitionedRecord;
      try {
        transitionedRecord = await tx.employmentRecord.update({
          where: { id: record.id, version: record.version },
          data: { 
            status: EmploymentStatus.PENDING,
            submitted_for_review_at: new Date(), 
            version: { increment: 1 } 
          },
        });
      } catch (error: any) {
        if (error.code === 'P2025') {
          throw new ConflictError('Record has been modified by another process. Please refresh and try again.');
        }
        throw error;
      }

      await this.logAudit(
        actor.userId,
        actor.role,
        record.status === EmploymentStatus.REJECTED ? 'employee.lifecycle.resubmitted_for_review' : 'employee.lifecycle.submitted_for_review',
        'EMPLOYMENT_RECORD',
        record.id,
        { submitted_for_review_at: transitionedRecord.submitted_for_review_at },
        undefined, undefined, undefined, tx
      );

      return transitionedRecord;
    });

    if (record.status === EmploymentStatus.REJECTED) {
      this.logDomainEvent('EVT-EMP-resubmitted_for_review', record.employee_id, EmploymentStatus.PENDING);
    } else {
      this.logDomainEvent('EVT-EMP-submitted_for_review', record.employee_id, EmploymentStatus.PENDING);
    }

    // Notify whoever this record actually routes to (resolveReviewerRecipients
    // mirrors getReviewQueue's rule), so the reviewer learns there is
    // something waiting instead of having to poll the queue.
    //
    // Wrapped: RESOLVING the recipient must not be able to fail the
    // submission. notifyOnboarding() already swallows per-recipient send
    // failures, but the lookup that feeds it sits outside that guard, so an
    // error there would propagate and reject a submission that has ALREADY
    // committed -- the user would see a failure for work that succeeded.
    try {
      const reviewers = await this.resolveReviewerRecipients(record);
      await this.notifyOnboarding(
        reviewers,
        'ONBOARDING_SUBMITTED',
        'Application awaiting review',
        `${record.job_title} application submitted for review.`,
        { employee_id: record.employee_id, user_id: record.user_id, is_reonboarding: record.employment_cycle > 1 },
      );
    } catch (error) {
      logger.error('employee_onboarding_reviewer_resolution_failed', {
        employeeId: record.employee_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return toGeneralProfile(updated);
  }

  /**
   * PENDING -> ACTIVE (hire approval).
   *
   * Group resolution runs inside the transition's transaction, so the
   * resolved hotel_group_id and the ACTIVE status commit together — an
   * approval cannot half-apply (status ACTIVE, group unset). Resolution
   * order: (1) target_hotel_group_id, the scope chosen when the application
   * was created, (2) an already-set hotel_group_id, (3) the approving
   * actor's own group when they are scoped to one. If none resolve,
   * hotel_group_id is left null — PROVISIONAL: the record becomes Active but
   * unassignable until a group is set.
   *
   * This docstring previously described resolution that the body did not do
   * (it passed `data: {}`), which is how the half-applied state it warns
   * about became the normal outcome.
   */
  async approve(actor: AuthContext, employeeId: string) {
    const record = await this.findRecordOrThrow(employeeId);
    await this.assertLifecycleAuthority(actor, record, 'approve an employee', {
      allowUnassignedGroup: true,
    });

    // assertTransition(PENDING, ACTIVE) alone cannot express this: the
    // transition table has no notion of PENDING's own sub-state
    // (submitted_for_review_at), so without this check an application that
    // was never submitted for review could be approved directly (found in
    // review, 2026-08-06). submitForReview() is the only writer of this
    // field, so its absence means exactly "never submitted."
    if (!record.submitted_for_review_at) {
      throw new ConflictError('Cannot approve an application that has not been submitted for review');
    }

    // 2026-08-13 fix ("the Approve button does not work"). approve() requires
    // a CONFIRMED contract, but nothing in the reviewer's own surface ever
    // confirmed one: the applicant uploads their signed copy as a CONTRACT_SCAN
    // document, and confirmation lived on a separate HR screen the reviewer
    // had no reason to visit. Every approval therefore 409'd, and the UI's
    // own pre-check disabled the button outright.
    //
    // Approving IS the manager's review of the returned signed contract
    // (RULE-HR-03) -- the same human act -- so it confirms the pending
    // contract, attributed to the approving actor and audited by HR's own
    // confirmation record. With no scan on file this is a no-op and
    // assertApprovedContract below produces the real message.
    await hrService.confirmSignedContractIfPending(record.user_id, actor.userId, actor.role);

    await this.assertApprovedContract(record.user_id);

    // Approval promotes the scope the application was created with.
    //
    // Approve used to be status-only ("ADR-065 §6 item 6: does not write scope
    // fields"), which contradicted this method's own docstring above -- the one
    // promising an approval "can no longer half-apply (status ACTIVE, group
    // unset)". Half-applying is exactly what happened, and it was not a
    // harmless inconsistency: listUsers() scopes every non-admin to
    // `employment_record: { hotel_group_id, status: ACTIVE }`, so an approved
    // employee with a null hotel_group_id is invisible in the Users tab to
    // every manager and RM -- including the person who created and approved
    // them. Only an admin could see them. Confirmed on production, where both
    // employees onboarded through the UI were ACTIVE with hotel_group_id null
    // and only target_hotel_group_id set.
    //
    // target_* is the scope the creating actor chose at creation time, so
    // promoting it here writes no new decision -- it commits the one already
    // made, atomically with the status. Resolution stays conservative: an
    // explicit target wins, and the actor's own group is used only as the
    // fallback the docstring already described. If neither resolves,
    // hotel_group_id is left null (PROVISIONAL) rather than guessed.
    const resolvedGroupId =
      record.target_hotel_group_id ??
      record.hotel_group_id ??
      (actor.scope?.type === 'hotel_group' ? actor.scope.hotel_group_id : null);

    const updated = await this.prisma.$transaction(async (tx) => {
      // A Hotel belongs to exactly one HotelGroup (schema.prisma: Hotel
      // .hotel_group_id is non-null), so promoting the target hotel blindly
      // could pin someone to a hotel OUTSIDE the group just resolved above --
      // an internally inconsistent record that every group-scoped query would
      // then disagree about. Verified against the resolved group, in the same
      // transaction, so the check cannot race a hotel being moved between
      // groups: a mismatch simply leaves primary_hotel unset for assign() to
      // resolve deliberately, rather than guessing.
      let primaryHotelId: string | null = null;
      if (resolvedGroupId && record.target_primary_hotel_id && !record.primary_hotel_id) {
        const targetHotel = await tx.hotel.findUnique({
          where: { id: record.target_primary_hotel_id },
          select: { hotel_group_id: true },
        });
        if (targetHotel?.hotel_group_id === resolvedGroupId) {
          primaryHotelId = record.target_primary_hotel_id;
        }
      }

      const transitionedRecord = await this.applyTransition(tx, record, EmploymentStatus.ACTIVE, {
        actorUserId: actor.userId,
        data: {
          ...(resolvedGroupId ? { hotel_group: { connect: { id: resolvedGroupId } } } : {}),
          ...(primaryHotelId ? { primary_hotel: { connect: { id: primaryHotelId } } } : {}),
        },
      });

      await this.logAudit(actor.userId, actor.role, 'employee.lifecycle.approved', 'EMPLOYMENT_RECORD', record.id, {
        from: record.status,
        to: EmploymentStatus.ACTIVE,
      }, undefined, undefined, undefined, tx);

      return transitionedRecord;
    });

    this.logDomainEvent('EVT-EMP-approved', record.employee_id, EmploymentStatus.ACTIVE);

    // The applicant is the one waiting on this outcome.
    await this.notifyOnboarding(
      [record.user_id],
      'ONBOARDING_APPROVED',
      'Onboarding approved',
      'Your onboarding has been approved. Welcome aboard!',
      { employee_id: record.employee_id },
    );

    return toGeneralProfile(updated);
  }

  /**
   * Writes the scope fields (hotel_group_id / primary_hotel_id) for an
   * already-approved employment record.
   *
   * PRIVILEGE-ESCALATION GUARD (found 2026-08-12 by real E2E probing, not by
   * the suite -- scenario 02 asserted step *ordering* but never that assign
   * REQUIRES approval): `approve` is deliberately status-only ("does not write
   * scope fields", see above), which makes THIS method the only writer of the
   * scope claims that end up in a user's JWT. It previously checked lifecycle
   * *authority* (who the actor is) but never the record's *status*, so a
   * PENDING -- including an explicitly just-refused -- application could be
   * handed a real, usable `regional_manager_user_id` / `manager_user_id`
   * binding: `approve` correctly returned 409, then `assign` returned 200 and
   * granted the scope anyway.
   *
   * Assign is therefore gated on ACTIVE, mirroring `approve`'s
   * `submitted_for_review_at` gate. Every other transition guards itself; this
   * one must too. Do not relax this to "any status" to make a test pass --
   * `onboarding-assign-requires-approval.test.ts` pins the behaviour.
   */
  async assign(actor: AuthContext, employeeId: string, payload: { hotel_group_id?: string; primary_hotel_id?: string }) {
    const record = await this.findRecordOrThrow(employeeId);
    await this.assertLifecycleAuthority(actor, record, 'assign an employee', { allowUnassignedGroup: true });

    if (record.status !== EmploymentStatus.ACTIVE) {
      throw new ConflictError(
        'Cannot assign an employee whose application has not been approved'
      );
    }

    if (actor.role === 'regional_manager' && payload.hotel_group_id) {
      const ownGroupId = await this.resolveApprovalGroupId(actor);
      if (payload.hotel_group_id !== ownGroupId) {
        throw new ForbiddenError('Cannot assign employee to a different hotel group');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const dataToUpdate: Prisma.EmploymentRecordUpdateInput = {};
      if (payload.hotel_group_id !== undefined) {
        dataToUpdate.hotel_group = payload.hotel_group_id ? { connect: { id: payload.hotel_group_id } } : { disconnect: true };
      }
      if (payload.primary_hotel_id !== undefined) {
        dataToUpdate.primary_hotel = payload.primary_hotel_id ? { connect: { id: payload.primary_hotel_id } } : { disconnect: true };
      }

      let newRecord;
      try {
        newRecord = await tx.employmentRecord.update({
          where: { id: record.id, version: record.version },
          data: { ...dataToUpdate, version: { increment: 1 } },
          include: {
            user: {
              select: {
                id: true,
                role: true,
              }
            }
          }
        });
      } catch (error: any) {
        if (error.code === 'P2025') {
          if (error.message && error.message.includes('connect')) {
            throw new NotFoundError('Target hotel or hotel group not found');
          }
          throw new ConflictError('Record has been modified by another process. Please refresh and try again.');
        }
        throw error;
      }

      if (newRecord.user.role === 'MANAGER' && payload.primary_hotel_id) {
        const targetHotel = await tx.hotel.findUnique({ where: { id: payload.primary_hotel_id } });
        if (targetHotel && targetHotel.manager_user_id && targetHotel.manager_user_id !== newRecord.user_id) {
          throw new ConflictError('Hotel already has a different manager assigned');
        }

        const ownedHotels = await tx.hotel.findMany({
          where: { manager_user_id: newRecord.user_id },
          select: { id: true },
        });
        const now = new Date();
        for (const hotel of ownedHotels) {
          if (hotel.id !== payload.primary_hotel_id) {
            await tx.hotel.update({
              where: { id: hotel.id },
              data: {
                manager_user_id: null,
                manager_assigned_at: null,
                manager_vacated_at: now,
                manager_vacancy_reason: 'TRANSFERRED',
              },
            });
            await tx.hotelManagerAssignmentHistory.updateMany({
              where: { hotel_id: hotel.id, manager_user_id: newRecord.user_id, unassigned_at: null },
              data: { unassigned_at: now, unassigned_by_id: actor.userId, reason: 'TRANSFERRED' },
            });
          }
        }

        await tx.hotel.update({
          where: { id: payload.primary_hotel_id },
          data: { 
            manager_user_id: newRecord.user_id,
            manager_assigned_at: now,
            manager_vacated_at: null,
            manager_vacancy_reason: null,
          },
        });
        await tx.hotelManagerAssignmentHistory.create({
          data: {
            hotel_id: payload.primary_hotel_id,
            manager_user_id: newRecord.user_id,
            assigned_at: now,
            assigned_by_id: actor.userId,
          },
        });
      } else if (newRecord.user.role === 'REGIONAL_MANAGER' && payload.hotel_group_id) {
        const targetGroup = await tx.hotelGroup.findUnique({ where: { id: payload.hotel_group_id } });
        if (targetGroup && targetGroup.regional_manager_user_id && targetGroup.regional_manager_user_id !== newRecord.user_id) {
          throw new ConflictError('Hotel group already has a different regional manager assigned');
        }

        const ownedGroup = await tx.hotelGroup.findUnique({
          where: { regional_manager_user_id: newRecord.user_id },
          select: { id: true },
        });
        const now = new Date();
        if (ownedGroup && ownedGroup.id !== payload.hotel_group_id) {
          await tx.hotelGroup.update({
            where: { id: ownedGroup.id },
            data: {
              regional_manager_user_id: null,
              regional_manager_assigned_at: null,
              regional_manager_vacated_at: now,
              regional_manager_vacancy_reason: 'TRANSFERRED',
            },
          });
          await tx.regionalManagerAssignmentHistory.updateMany({
            where: { hotel_group_id: ownedGroup.id, regional_manager_user_id: newRecord.user_id, unassigned_at: null },
            data: { unassigned_at: now, unassigned_by_id: actor.userId, reason: 'TRANSFERRED' },
          });
        }

        await tx.hotelGroup.update({
          where: { id: payload.hotel_group_id },
          data: { 
            regional_manager_user_id: newRecord.user_id,
            regional_manager_assigned_at: now,
            regional_manager_vacated_at: null,
            regional_manager_vacancy_reason: null,
          },
        });
        await tx.regionalManagerAssignmentHistory.create({
          data: {
            hotel_group_id: payload.hotel_group_id,
            regional_manager_user_id: newRecord.user_id,
            assigned_at: now,
            assigned_by_id: actor.userId,
          },
        });
      }

      await this.logAudit(actor.userId, actor.role, 'employee.lifecycle.assigned', 'EMPLOYMENT_RECORD', record.id, {
        from_hotel_group_id: record.hotel_group_id,
        to_hotel_group_id: newRecord.hotel_group_id,
        from_primary_hotel_id: record.primary_hotel_id,
        to_primary_hotel_id: newRecord.primary_hotel_id,
      }, undefined, undefined, undefined, tx);

      return newRecord;
    });

    this.logDomainEvent('EVT-EMP-assigned', record.employee_id, updated.status);

    return toGeneralProfile(updated);
  }

  /** PENDING -> REJECTED (hire application declined). */
  async reject(actor: AuthContext, employeeId: string, reason?: string) {
    const record = await this.findRecordOrThrow(employeeId);
    await this.assertLifecycleAuthority(actor, record, 'reject an employee', {
      allowUnassignedGroup: true,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const transitionedRecord = await this.applyTransition(tx, record, EmploymentStatus.REJECTED, {
        actorUserId: actor.userId,
        reason: reason ?? null,
      });

      await this.logAudit(actor.userId, actor.role, 'employee.lifecycle.rejected', 'EMPLOYMENT_RECORD', record.id, {
        from: record.status,
        to: EmploymentStatus.REJECTED,
        reason: reason ?? null,
      }, undefined, undefined, undefined, tx);

      return transitionedRecord;
    });

    this.logDomainEvent('EVT-EMP-rejected', record.employee_id, EmploymentStatus.REJECTED);

    // Contract/onboarding desync fix (2026-08-13 audit): HR may already have
    // confirmed the signature before the manager decided, leaving a REJECTED
    // applicant holding an ACTIVE contract with a running expiry clock.
    await hrService.standDownContractsFor(record.user_id, 'employment_rejected');

    await this.notifyOnboarding(
      [record.user_id],
      'ONBOARDING_REJECTED',
      'Onboarding not approved',
      reason
        ? `Your onboarding was not approved: ${reason}`
        : 'Your onboarding was not approved. Contact your manager for details.',
      { employee_id: record.employee_id },
    );

    return toGeneralProfile(updated);
  }

  /**
   * ACTIVE -> DEACTIVATED: a TEMPORARY pause (leave / seasonal / suspension).
   *
   * Deliberately does NOT set deleted_at, unlike the pre-rework deactivate()
   * this replaces. That old coupling (status DEACTIVATED always paired with
   * deleted_at) is what made DEACTIVATED mean "left the company" — the
   * 20260806123146_employment_lifecycle_rework migration remapped every such
   * historical row to DELETED for exactly that reason. "Left the company" is
   * now delete() below; DEACTIVATED is a pause the person returns from via
   * reactivate(), with the employment record and its group intact.
   *
   * Future assignments are still cancelled: a paused worker cannot be
   * expected to show up for shifts already on the calendar.
   */
  async deactivate(actor: AuthContext, employeeId: string, reason: DeactivationReason) {
    const record = await this.findRecordOrThrow(employeeId);
    await this.assertLifecycleAuthority(actor, record, 'deactivate an employee');

    // RULE-EMP-02 rework: deactivation_reason is required for this edge
    // (schema.prisma EmploymentRecord.deactivation_reason). Validated here
    // and not only at the Zod boundary, because deactivate() is reachable
    // from any in-process caller, not just the route.
    if (!reason || !Object.values(DeactivationReason).includes(reason)) {
      throw new ValidationError('deactivation_reason is required', [
        {
          field: 'deactivation_reason',
          message: `Must be one of ${Object.values(DeactivationReason).join(', ')}`,
        },
      ]);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.applyTransition(tx, record, EmploymentStatus.DEACTIVATED, {
        actorUserId: actor.userId,
        reason,
        data: { deactivation_reason: reason },
      });

      // Shared with delete() (vacateManagedScopes) so the two paths cannot
      // drift -- delete() omitting this is exactly the "manager ghosting" bug.
      // TEMPORARY here: a paused manager is expected back, unlike a
      // termination.
      const now = new Date();
      await this.vacateManagedScopes(tx, record.user_id, actor.userId, 'TEMPORARY', now);

      // Session invalidation (2026-08-07). DELETED (delete(),
      // deactivateForContractLapse()) and DELETED -> PENDING (restore())
      // all bump token_generation; DEACTIVATED did not, which left a paused
      // employee holding a valid access token for up to JWT_ACCESS_EXPIRY.
      //
      // That gap was real, not theoretical: middleware/auth.ts only reads
      // User.is_active / deleted_at / token_generation and never consults
      // EmploymentRecord.status, and deactivate() deliberately touches
      // neither User column (a pause is not an account revocation). So
      // nothing else in the request pipeline would have noticed.
      //
      // Scheduling paths did fail closed already -- roster-scope.ts gates on
      // status === ACTIVE -- but the modules that don't route through it
      // (documents, hr, consent, notifications) had no employment check at
      // all, so a just-paused worker could still read contracts and payslips
      // until their token expired naturally.
      //
      // Bumping here does NOT revoke the account: is_active stays true and
      // deleted_at stays null, so the person can re-authenticate. It ends
      // the CURRENT session, which is the correct granularity for "no longer
      // cleared to work, but still an employee" -- and reactivate() needs no
      // counterpart bump, since a fresh login already picks up ACTIVE.
      await bumpTokenGeneration(tx, record.user_id);

      // Tell the person it happened. Deactivation ends their current session
      // (the bump above) and stops them being staffed, so without this the
      // first they learn of it is being unable to work -- the account simply
      // stops behaving and says nothing. ACCOUNT_DEACTIVATED has existed as a
      // NotificationType since the account-lifecycle values were added and had
      // no writer until now.
      //
      // Enqueued inside the transaction, per ADR-029's single-commit outbox:
      // the notification and the status change either both land or neither
      // does, so nobody is told about a transition that rolled back.
      await notificationService.enqueue(
        {
          recipientId: record.user_id,
          type: NotificationType.ACCOUNT_DEACTIVATED,
          title: 'Your account has been deactivated',
          message:
            'You will not be scheduled for shifts while your account is deactivated. Contact your manager if you believe this is a mistake.',
          data: { employment_record_id: record.id, reason },
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.EMPLOYEE_MANAGEMENT,
          producerService: 'EmployeeManagementService',
        },
        tx
      );

      return result;
    });

    // After the transition commits, not inside it — see
    // cancelFutureAssignments()'s own note on the transaction boundary.
    await this.cancelFutureAssignments(record.user_id, `Employee deactivated (${reason})`, actor.userId);

    await this.logAudit(actor.userId, actor.role, 'employee.deactivate', 'EMPLOYMENT_RECORD', record.id, {
      from: record.status,
      to: EmploymentStatus.DEACTIVATED,
      deactivation_reason: reason,
    });

    this.logDomainEvent('EVT-EMP-deactivated', record.employee_id, EmploymentStatus.DEACTIVATED);

    return toGeneralProfile(updated);
  }

  /**
   * DEACTIVATED -> ACTIVE: the paused employee returns.
   *
   * Direct, with no re-approval and no group re-resolution: deactivate()
   * never cleared hotel_group_id (the person never left the group, they were
   * paused within it), so the record is immediately assignable again. This is
   * the whole point of the DEACTIVATED/DELETED split — only a DELETED return
   * is a true rehire, and that one is gated through PENDING.
   */

  /**
   * DEACTIVATED -> PENDING: worker or manager triggers re-onboarding.
   *
   * Increments employment_cycle (applyTransition() bumps it for this edge
   * alongside restore()'s DELETED -> PENDING, see that method's comment) so
   * this counts as a new engagement cycle: submitForReview() re-checks the
   * contract only, keeping previously-uploaded static documents valid.
   *
   * Only reachable when the existing contract can no longer stand -- see the
   * guard below. A DEACTIVATED record whose contract is still valid returns
   * via reactivate() instead, directly, with no re-submission at all.
   */
  async triggerReonboarding(actor: AuthContext, employeeId: string) {
    const record = await this.findRecordOrThrow(employeeId);
    if (record.status !== 'DEACTIVATED') {
      throw new ConflictError('Only a deactivated employee can start re-onboarding');
    }

    // We allow self-triggering for workers, or scoped authority for managers
    if (actor.role === 'worker' && record.user_id !== actor.userId) {
      throw new ForbiddenError('Workers can only trigger re-onboarding for themselves');
    } else if (actor.role !== 'worker') {
      await this.assertLifecycleAuthority(actor, record, 'trigger re-onboarding');
    }

    // Without this, a worker (or manager) could call this endpoint on a
    // DEACTIVATED record whose contract is still perfectly valid, forcing an
    // unnecessary employment_cycle bump and a full re-submission cycle when
    // reactivate() would return them directly. The frontend already gates its
    // button on contract expiry; this is the authoritative check.
    const contract = await this.ensureValidContract(record);
    if (contract && isContractValid(contract)) {
      throw new ConflictError(
        "This employee's contract is still valid; use reactivate() instead of re-onboarding."
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.applyTransition(tx, record, EmploymentStatus.PENDING, {
        actorUserId: actor.userId,
        data: {
          submitted_for_review_at: null,
          deactivation_reason: null,
        },
      });

      await this.logAudit(actor.userId, actor.role, 'employee.trigger_reonboarding', 'EMPLOYMENT_RECORD', record.id, {
        from: record.status,
        to: EmploymentStatus.PENDING,
      }, undefined, undefined, undefined, tx);

      return result;
    });

    return toGeneralProfile(updated);
  }

  async reactivate(actor: AuthContext, employeeId: string) {
    const record = await this.findRecordOrThrow(employeeId);
    await this.assertLifecycleAuthority(actor, record, 'reactivate an employee');

    const updated = await this.prisma.$transaction(async (tx) => {
      const transitionedRecord = await this.applyTransition(tx, record, EmploymentStatus.ACTIVE, {
        actorUserId: actor.userId,
        // Clear the pause reason: it described a pause that has now ended,
        // and leaving it set would make an ACTIVE record read as if it were
        // still on leave. The history row retains it permanently.
        data: { deactivation_reason: null },
      });

      await this.logAudit(actor.userId, actor.role, 'employee.reactivate', 'EMPLOYMENT_RECORD', record.id, {
        from: record.status,
        to: EmploymentStatus.ACTIVE,
      }, undefined, undefined, undefined, tx);

      // The counterpart to deactivate()'s notification. Reactivation is the
      // one the person most needs pushed: they were told to stop, and nothing
      // in the app would otherwise tell them they can work again -- they would
      // have to keep checking. ACCOUNT_REACTIVATED likewise had no writer until
      // now. Same single-commit outbox placement as deactivate().
      await notificationService.enqueue(
        {
          recipientId: record.user_id,
          type: NotificationType.ACCOUNT_REACTIVATED,
          title: 'Your account is active again',
          message: 'You can be scheduled for shifts again. Check your upcoming shifts.',
          data: { employment_record_id: record.id },
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.EMPLOYEE_MANAGEMENT,
          producerService: 'EmployeeManagementService',
        },
        tx
      );

      return transitionedRecord;
    });

    this.logDomainEvent('EVT-EMP-reactivated', record.employee_id, EmploymentStatus.ACTIVE);

    return toGeneralProfile(updated);
  }

  /**
   * REJECTED -> ACTIVE: a previously-declined applicant is taken on after all.
   *
   * Direct rather than back through PENDING: a REJECTED record was never
   * approved, so there is no prior employment cycle to close and reopen —
   * employment_cycle stays 1 (applyTransition increments only on
   * DELETED -> PENDING). Note this edge does NOT resolve hotel_group_id the
   * way approve() does, since a rejected record may legitimately have none;
   * see assertLifecycleAuthority()'s note on what that means for scoping.
   */
  async rehire(actor: AuthContext, employeeId: string) {
    const record = await this.findRecordOrThrow(employeeId);
    await this.assertLifecycleAuthority(actor, record, 'rehire an employee', {
      allowUnassignedGroup: true,
    });

    // Same reasoning as approve() above: rehire is the identical review act
    // on a previously-rejected application, and gating it on a confirmation
    // that happens on another screen makes it unreachable in practice.
    await hrService.confirmSignedContractIfPending(record.user_id, actor.userId, actor.role);

    await this.assertApprovedContract(record.user_id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const transitionedRecord = await this.applyTransition(tx, record, EmploymentStatus.ACTIVE, {
        actorUserId: actor.userId,
      });

      await this.logAudit(actor.userId, actor.role, 'employee.rehire', 'EMPLOYMENT_RECORD', record.id, {
        from: record.status,
        to: EmploymentStatus.ACTIVE,
      }, undefined, undefined, undefined, tx);

      return transitionedRecord;
    });

    this.logDomainEvent('EVT-EMP-rehired', record.employee_id, EmploymentStatus.ACTIVE);

    return toGeneralProfile(updated);
  }

  /**
   * ACTIVE/DEACTIVATED/REJECTED -> DELETED: the person left the company.
   *
   * DELETED == deleteUser() (schema.prisma EmploymentRecord.deleted_at,
   * "Decision 1"): this is ONE action across both records, not an employment
   * change that a separate admin step later mirrors onto the account. The
   * EmploymentRecord soft-delete, the User soft-delete, and the
   * token_generation bump therefore commit in a single transaction —
   * reproducing users/service.ts#deleteUser's own ADR-031 D-4 (C-5) shape
   * (a deleted account must never remain authorizable on an already-issued
   * access token) rather than approximating it. bumpTokenGeneration() is
   * imported from backend-auth, the sole authoritative writer of that column
   * (ADR-031 D-4 PR-4); this module never increments it directly.
   *
   * Admin-only, unrestricted scope: unlike the approve/reject/deactivate/
   * reactivate/rehire set, this crosses the account boundary — it revokes
   * platform access, not just employment status — so the blast radius is
   * strictly larger than anything a scope-bound manager is trusted with.
   */
  async delete(actor: AuthContext, employeeId: string, deletedReason: string) {
    const record = await this.findRecordOrThrow(employeeId);

    if (actor.role !== 'admin') {
      if (record.status !== EmploymentStatus.PENDING) {
        throw new ForbiddenError('Only Admin may delete an active employee');
      }
      // If PENDING, allow managers. findRecordOrThrow doesn't enforce scope,
      // so we must enforce it here manually like we do in getRecord/update:
      if (actor.role === 'manager' || actor.role === 'regional_manager') {
        const canAccess = await this.isRecordInScope(actor, record);
        if (!canAccess) throw new ForbiddenError('Access denied to this employee');
      } else {
        throw new ForbiddenError('Only Admin or Managers may delete an employee');
      }
    }


    if (!deletedReason || !deletedReason.trim()) {
      throw new ValidationError('deleted_reason is required', [
        { field: 'deleted_reason', message: 'Reason must not be blank' },
      ]);
    }
    const reason = deletedReason.trim();

    const updated = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const result = await this.applyTransition(tx, record, EmploymentStatus.DELETED, {
        actorUserId: actor.userId,
        reason,
        data: { deleted_reason: reason, deleted_at: now },
        // The authorization block at the top of this method already decided a
        // PENDING record may be removed here (and by whom). Without this the
        // missing PENDING -> DELETED edge threw first, so that decision never
        // took effect -- see applyTransition's own comment.
        allowPendingApplicationRemoval: true,
      });

      // Manager ghosting fix (2026-08-13 audit): deactivate() vacated managed
      // hotels/groups but delete() did not, so terminating a manager left the
      // hotel permanently pointing at a soft-deleted user and unassignable.
      await this.vacateManagedScopes(tx, record.user_id, actor.userId, 'TERMINATED', now);

      // Re-onboarding scope-leak fix (2026-08-13 audit): hotel_group_id and
      // primary_hotel_id survived deletion, so a rehired worker came back
      // still scoped to the group that let them go. That both LOCKED OUT the
      // new manager (their scope check compares against the stale group) and
      // LEAKED the returning worker's new contract/onboarding to the old
      // manager, who could still see them via group-scoped list reads.
      // Cleared here, at the point employment actually ends, rather than in
      // restore(): the association is untrue the moment the person leaves,
      // not merely when they come back.
      await tx.employmentRecord.update({
        where: { id: record.id },
        data: { hotel_group_id: null, primary_hotel_id: null },
      });

      await tx.user.update({
        where: { id: record.user_id },
        data: { deleted_at: now, is_active: false },
      });
      await bumpTokenGeneration(tx, record.user_id);

      return result;
    });

    // After the account is revoked, not before: a cancellation cascade that
    // failed mid-way would otherwise leave a still-authorizable account.
    await this.cancelFutureAssignments(record.user_id, `Employee deleted (${reason})`, actor.userId);

    await this.logAudit(actor.userId, actor.role, 'employee.delete', 'EMPLOYMENT_RECORD', record.id, {
      from: record.status,
      to: EmploymentStatus.DELETED,
      deleted_reason: reason,
    });
    await this.logAudit(actor.userId, actor.role, 'MODIFY', 'USER', record.user_id, {
      action: 'token_generation_bumped',
      reason: 'employment_deleted',
    });

    this.logDomainEvent('EVT-EMP-deleted', record.employee_id, EmploymentStatus.DELETED);

    // Same desync as reject(): a departed employee must not keep a contract
    // the system still reports as valid.
    await hrService.standDownContractsFor(record.user_id, 'employment_deleted');

    return toGeneralProfile(updated);
  }

  /**
   * DELETED -> PENDING: a former employee is taken back on (a true rehire).
   *
   * Lands in PENDING, not ACTIVE — the person must be re-approved, which is
   * what makes this distinct from reactivate()'s direct return. applyTransition()
   * increments employment_cycle on exactly this edge.
   *
   * The User account is un-soft-deleted here (the DELETED == deleteUser()
   * unification runs in both directions), but token_generation is bumped
   * AGAIN rather than left alone. That is deliberate, not a copy-paste of
   * delete(): any access token minted before the delete is still floating
   * around, and restoring the account must not silently re-validate it.
   * Sessions stay invalidated; the restored account's access is for
   * onboarding/profile completion only while PENDING, and full operational
   * access resumes only when approve() moves it to ACTIVE.
   *
   * Admin-only, same account-boundary rationale as delete().
   */
  async restore(actor: AuthContext, employeeId: string) {
    if (actor.role !== 'admin') {
      throw new ForbiddenError('Only Admin may restore an employee');
    }

    // findRecordOrThrow() does not filter deleted_at (see its own note), so a
    // soft-deleted record is resolvable here — which restore() requires.
    const record = await this.findRecordOrThrow(employeeId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.applyTransition(tx, record, EmploymentStatus.PENDING, {
        actorUserId: actor.userId,
        data: {
          deleted_at: null,
          deleted_reason: null,
          // A restored record starts its new cycle un-submitted: the previous
          // cycle's onboarding submission says nothing about this one.
          submitted_for_review_at: null,
          deactivation_reason: null,
          // Same reasoning extends to probation: marked_suitable is a
          // milestone earned by working the previous cycle, not a fact about
          // the person that survives a full leave-and-return. Left uncleared,
          // a cycle-2 PENDING record would read as already past probation
          // before the rehired person has worked a single day (found in
          // adversarial review, 2026-08-06).
          marked_suitable: false,
        },
      });

      await tx.user.update({
        where: { id: record.user_id },
        data: { deleted_at: null, is_active: true },
      });
      await bumpTokenGeneration(tx, record.user_id);

      return result;
    });

    // TODO (out of scope for this PR): trigger the restored user's
    // re-onboarding credential flow. The only existing mechanism is
    // auth/service.ts#requestPasswordReset, which is email-keyed, silently
    // no-ops for a user it considers unavailable, and is designed as an
    // unauthenticated self-service entry point — calling it from an
    // admin-initiated restore would be repurposing it, not reusing it. An
    // admin-initiated credential-issuance seam does not exist yet; adding one
    // is new auth infrastructure and belongs in its own change. Until then a
    // restored user must go through the normal /auth/password-reset flow
    // themselves, which works because this method sets is_active = true and
    // clears deleted_at above (requestPasswordReset's own preconditions).

    await this.logAudit(actor.userId, actor.role, 'employee.restore', 'EMPLOYMENT_RECORD', record.id, {
      from: record.status,
      to: EmploymentStatus.PENDING,
      employment_cycle: updated.employment_cycle,
    });
    await this.logAudit(actor.userId, actor.role, 'MODIFY', 'USER', record.user_id, {
      action: 'token_generation_bumped',
      reason: 'employment_restored',
    });

    this.logDomainEvent('EVT-EMP-restored', record.employee_id, EmploymentStatus.PENDING);

    return toGeneralProfile(updated);
  }

  // ADR-045 (2026-07-28, resolving OD-EMP-04): HR implementation PR 5. A
  // narrow, purpose-built internal method for backend-hr's contract-lapse
  // trigger (ADR-040: manager-confirmed "do not continue" action, or
  // manager silence past a deadline detected by HR's own scheduled job —
  // both call this the same way). No actor.role gate, unlike the
  // user-facing lifecycle methods above: this is an internal cross-module
  // call, not a route, and ADR-040's manager-only/scheduled-job rules
  // already gate the caller (backend-hr) before this method is ever
  // reached — mirroring the same authorization-boundary shape ADR-032
  // established for every other direct in-process cross-module call on this
  // platform (the caller's own authz, not a second check here). Keyed by
  // user_id (backend-hr only holds Contract.worker_id, a User.id), not
  // employee_id like findRecordOrThrow() above -- HR has no reason to know
  // employee-management's own human-facing employee_id.
  //
  // *** BEHAVIOR CHANGE (2026-08-06 rework) — READ BEFORE CHANGING ***
  // This method now produces DELETED, not DEACTIVATED. Under the reworked
  // lifecycle DEACTIVATED means a temporary pause the employee returns from
  // (leave/seasonal/suspension), whereas an expired, non-continued contract
  // means the person has left the company — the former-employee case, which
  // is DELETED by definition (schema.prisma EmploymentStatus). This is not a
  // renaming: DELETED is unified with User soft-delete, so a contract lapse
  // now ALSO deactivates the account (deleted_at, is_active = false) and
  // invalidates the worker's sessions via token_generation, none of which
  // happened before. That consequence is intended — an ex-employee retaining
  // a live login was the pre-rework gap, not a feature — but it is a real,
  // observable escalation of what HR's lapse action does, so any future
  // change to make lapse reversible must go through restore() (DELETED ->
  // PENDING -> ACTIVE), not by pointing this back at deactivate().
  async deactivateForContractLapse(userId: string, reason: string): Promise<void> {
    const record = await this.prisma.employmentRecord.findUnique({ where: { user_id: userId } });
    if (!record) return; // no employment record to act on -- nothing to do (best-effort, matches OD-CAL-06 precedent)
    if (record.status === EmploymentStatus.DELETED) return; // idempotent -- already gone

    const updated = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      // actorUserId is null, not a synthesized id: the actor is the platform
      // itself (HR's scheduled job or an in-process call), and
      // EmploymentStatusHistory.actor_user_id is nullable precisely for this
      // "system-driven transition" case (schema.prisma).
      const result = await this.applyTransition(tx, record, EmploymentStatus.DELETED, {
        actorUserId: null,
        reason,
        data: { deleted_reason: reason, deleted_at: now },
      });

      await tx.user.update({
        where: { id: record.user_id },
        data: { deleted_at: now, is_active: false },
      });
      await bumpTokenGeneration(tx, record.user_id);

      return result;
    });

    await this.cancelFutureAssignments(record.user_id, 'Contract lapsed', null);

    await this.logAudit(null, 'system', 'employee.deactivate.contract_lapse', 'EMPLOYMENT_RECORD', record.id, {
      reason,
      to: EmploymentStatus.DELETED,
    });

    logger.info('domain_event', {
      event: 'EVT-EMP-deleted',
      employmentRecordId: updated.id,
      reason,
    });
  }

  /**
   * Cancels every future active WorkerAssignment for a worker whose
   * employment just ended or paused, one at a time through
   * AssignmentService.update().
   *
   * Shape and rationale are lifted from job-requests/service.ts#
   * cascadeCancelAssignments (that method is JobRequest-keyed and private to
   * its own module, so it cannot be called for a worker-keyed cascade — this
   * is the same delegation pattern re-keyed, not a second implementation of
   * "what happens when an assignment is cancelled"). Per-row rather than a
   * bulk updateMany precisely so every one of AssignmentService.update()'s
   * own side effects fires per assignment: the WorkerOverallRating recompute,
   * the JobRequestSkillSlot.confirmed_count decrement for a broadcast-accepted
   * assignment, and the cancellation notification to the worker.
   *
   * Runs AFTER the employment transaction commits, not inside it:
   * AssignmentService.update() opens its own transaction and is not
   * composable into an outer one (the same boundary job-requests' cascade and
   * CalendarService.autoCancelSameDayAssignment already accept). A crash
   * between the two leaves the employment record transitioned with
   * assignments still active — the identical, already-accepted tradeoff of
   * that existing delegation, not a new risk.
   *
   * "Future" is day >= today (UTC midnight): today's assignment counts as
   * future because a worker deactivated mid-morning still should not be
   * expected on a shift later that day. Past assignments are historical fact
   * and are never rewritten. The status filter reuses
   * ACTIVE_ASSIGNMENT_STATUSES (assignments/service.ts) rather than
   * re-listing CONFIRMED/IN_PROGRESS, so it stays in lock-step with the DB
   * partial index that defines that set.
   *
   * Note on JobRequest.status: cancelling a slot-bound assignment decrements
   * JobRequestSkillSlot.confirmed_count (inside AssignmentService.update()),
   * which can drop a slot back below its headcount. No FILLED -> OPEN flip is
   * performed or needed — verified 2026-08-06: no code path in this
   * repository ever writes WorkRequestStatus.FILLED (the only reference is
   * analytics/service.ts reading a count), so a broadcast whose slots refill
   * is still OPEN and immediately acceptable again. If a future PR introduces
   * a FILLED writer, it must also add the inbound FILLED -> OPEN edge to
   * job-requests/service.ts's ALLOWED_TRANSITIONS, which does not have one.
   */
  private async cancelFutureAssignments(
    workerId: string,
    cancellationReason: string,
    actorUserId: string | null
  ): Promise<void> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const assignments = await this.prisma.workerAssignment.findMany({
      where: {
        worker_id: workerId,
        day: { gte: today },
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      },
      select: { id: true },
    });

    for (const assignment of assignments) {
      await assignmentService.update(
        assignment.id,
        { status: AssignmentStatus.CANCELLED, cancellation_reason: cancellationReason },
        // Real actor id (never '') so AssignmentService.update()'s
        // worker-initiated-vs-not notification branch (actorId ===
        // assignment.worker_id) still routes correctly for the audit log and
        // the "who gets notified" decision.
        //
        // actorRole is hardcoded to 'admin', NOT actor.role, regardless of
        // who actually triggered this cascade (a scoped manager/RM via
        // deactivate()/delete(), or the system via
        // deactivateForContractLapse()). This is deliberate, not a shortcut:
        // AssignmentService.update() runs its OWN authorization check against
        // actorRole/actorScope (isSelfScopedRole / isScopedManagerRole +
        // isHotelInScope, assignments/service.ts ~157-180) — a second,
        // independent, HOTEL-grain gate on top of the GROUP-grain
        // authorization assertLifecycleAuthority() already performed on the
        // *employment* action that triggered this cascade. Passing the real
        // actor/role/scope through was found to fail in two ways: (a) role
        // 'system' (no real actor) falls through isSelfScopedRole's role list
        // to `true`, routing the cancel through isWorkerEligibleForHotel('')
        // which always denies; (b) a scoped manager authorized to deactivate
        // a worker across their whole hotel GROUP could still be denied by
        // update()'s narrower per-HOTEL check on a sibling hotel in the same
        // group, aborting the cascade mid-loop with some assignments already
        // cancelled. The employment-lifecycle service is the sole authority
        // that already decided this cascade may proceed; re-authorizing each
        // individual cancellation against a stricter, differently-grained
        // policy is incorrect, not merely redundant. 'admin' is unrestricted
        // by both of update()'s checks, which correctly reflects that no
        // further authorization is being deferred to this call.
        actorUserId ?? '',
        'admin',
        null
      );
    }
  }

  /**
   * Authorization for the employment-status lifecycle actions that stay
   * within employment (submit-for-review/approve/reject/deactivate/
   * reactivate/rehire).
   *
   * Admin is unrestricted. A scope-bound manager (Hotel Manager or Regional
   * Manager, per isScopedManagerRole) may act only within their own group —
   * the same group-grain question assertVisibility()/isRecordInScope() below
   * already answer for reads, here through the shared isWorkerInGroupScope()
   * primitive (lib/scope.ts, ADR-030 PR-1 C-10) since this is a scoped
   * *write*. Every other role is denied outright.
   *
   * `allowUnassignedGroup` (do not read its absence-handling as an
   * oversight): isWorkerInGroupScope() denies when the record has no
   * hotel_group_id (lib/scope.ts, deny-by-default), and hotel_group_id is
   * only ever set at approve() (ADR-023 §4) — so a PENDING or REJECTED
   * record is *always* group-less until the first approval it ever
   * receives. Checking the record's group for submit-for-review/approve/
   * reject/rehire would therefore deny every manager/RM unconditionally,
   * collapsing that entire tier of the permission matrix to admin-only by
   * accident rather than by decision (found in adversarial review,
   * 2026-08-06). For exactly those four group-less-eligible actions, this
   * method instead checks whether the ACTOR owns a group at all
   * (resolveApprovalGroupId — the same resolution approve() itself uses to
   * pick the group a newly-approved record gets connected to), not whether
   * that group matches the record's (there is nothing yet to match against).
   * This is authorization by "is this actor a manager/RM who owns a group",
   * which is the correct question for onboarding an unassigned applicant —
   * NOT by inferring and checking the record's intended group from the
   * actor, which would let the actor supply the very value being checked.
   * deactivate()/reactivate() do NOT set this flag: by the time either can
   * fire the record is ACTIVE or DEACTIVATED, which only ever follows a
   * completed approve(), so hotel_group_id is already set and the ordinary
   * record-group check applies.
   */
  private async assertLifecycleAuthority(
    actor: AuthContext,
    record: EmploymentRecord,
    action: string,
    opts: { allowUnassignedGroup?: boolean } = {}
  ): Promise<void> {
    // RULE B (project-owner decision, 2026-08-12): NOBODY may perform another
    // user's onboarding. submit-for-review is SELF-SERVICE ONLY — the
    // applicant submits their own application, and no role (admin included)
    // may submit on their behalf.
    //
    // This check is deliberately placed ABOVE the `admin` early-return: the
    // previous ordering let admin short-circuit out before the self-check was
    // ever reached, which is precisely the bypass RULE B closes. Ordering is
    // the security property here, not an incidental style choice — do not
    // hoist the admin return back above it.
    //
    // SCOPE — approve/assign/reject/deactivate/reactivate/rehire are NOT
    // self-service and deliberately keep the hierarchy checks below: a
    // Manager's application is still approved by an RM or Admin. Only
    // submit-for-review (and document upload, in documents/service.ts) became
    // self-only.
    if (action === 'submit an employee for review') {
      if (actor.userId === record.user_id) return;
      throw new ForbiddenError(
        'Only the applicant may submit their own application for review; no role may submit on another user\'s behalf'
      );
    }

    if (actor.role === 'admin') return;

    if (isScopedManagerRole(actor.role)) {
      const targetUser = await this.prisma.user.findUnique({ where: { id: record.user_id } });
      if (!targetUser) throw new NotFoundError('User not found');

      if (targetUser.role === 'REGIONAL_MANAGER') {
        throw new ForbiddenError(`Cannot ${action}: only Admin can manage Regional Manager applications`);
      }
      if (targetUser.role === 'MANAGER') {
        // A Regional Manager reviews Manager applications. This is no longer
        // gated on FEATURE_RM_ROLE (owner decision, 2026-08-14: "RM should do
        // it, keep the system consistent").
        //
        // The flag left the platform half-recognizing RMs: resolveScope()
        // already grants an RM their hotel_group scope from
        // HotelGroup.regional_manager_user_id without consulting it, so RMs
        // sign in, hold scope, and see scoped data -- but were refused the one
        // workflow the role exists for. An RM who creates a Manager could not
        // then approve them, so the application escalated to Admin and the
        // hierarchy the creation rule enforces was broken at review time.
        //
        // Scope still binds: the group check below requires the application to
        // target this RM's own group (ADR-065 §6 item 5), so this widens WHICH
        // role may review, never WHICH records they can reach.
        if (actor.role !== 'regional_manager') {
          throw new ForbiddenError(`Cannot ${action}: only Admin or Regional Manager can manage Manager applications`);
        }
      }

      if (record.hotel_group_id === null && opts.allowUnassignedGroup) {
        const ownGroupId = await this.resolveApprovalGroupId(actor);
        if (!ownGroupId) {
          throw new ForbiddenError(`Cannot ${action}: you do not manage a hotel group`);
        }
        
        // ADR-065 §6 item 5: Ensure RM is approving an application targeted at their group
        if (record.target_hotel_group_id && record.target_hotel_group_id !== ownGroupId) {
          throw new ForbiddenError(`Cannot ${action}: application is targeted at a different group`);
        }
        return;
      }

      const inScope = await isWorkerInGroupScope(actor.scope ?? null, record.user_id);
      if (!inScope) {
        throw new ForbiddenError(`Cannot ${action} outside your group`);
      }
      return;
    }

    throw new ForbiddenError(`Insufficient permissions to ${action}`);
  }

  // OD-EMP-09: no event bus exists in this codebase (every module records
  // published_events: none-observed); domain events are represented as a
  // structured log line only. Centralized here so every lifecycle method
  // emits the identical shape.
  private logDomainEvent(event: string, employeeId: string, status: EmploymentStatus): void {
    logger.info('domain_event', { event, employee_id: employeeId, status });
  }

  private async resolveApprovalGroupId(actor: AuthContext, explicitGroupId?: string): Promise<string | null> {
    // findUnique, not findFirst: regional_manager_user_id is a unique FK
    // (Regional Manager V1 Decision 1) — the same reasoning as
    // auth/service.ts#resolveScope.
    const ownGroup = await this.prisma.hotelGroup.findUnique({
      where: { regional_manager_user_id: actor.userId },
      select: { id: true },
    });
    if (ownGroup) return ownGroup.id;

    const managedHotel = await this.prisma.hotel.findFirst({
      where: { manager_user_id: actor.userId },
      select: { hotel_group_id: true },
    });
    if (managedHotel?.hotel_group_id) return managedHotel.hotel_group_id;

    if (explicitGroupId) return explicitGroupId;

    return null;
  }

  // ── Retention classification (REQ-EMP-008 / RULE-EMP-11) ────────────────

  getRetentionTiers() {
    return getRetentionTiers();
  }

  // ── Org chart (REQ-EMP-013 / RULE-EMP-08) ───────────────────────────────

  // IF-EMP-GetOrgChart / v0 (REQ-EMP-013, permission matrix "View org
  // chart": Regional Manager their own group, Admin all; no other role).
  // OD-EMP-12 leaves the underlying reporting-relationship model an open
  // decision -- this deliberately does NOT invent a manager-of-worker or
  // manager-of-manager hierarchy that has no schema representation. It
  // exposes exactly the group structure that already exists and is already
  // authoritative elsewhere in the codebase: one Regional Manager per
  // HotelGroup (`HotelGroup.regional_manager_user_id`), one Hotel Manager
  // per Hotel (`Hotel.manager_user_id`, nullable), and the group's active
  // employment records (group-grain per REQ-EMP-012, never filtered by
  // hotel directly -- EmploymentRecord has no hotel_id of its own).
  async getOrgChart(actor: AuthContext, hotelGroupId: string) {
    if (actor.role !== 'admin' && actor.role !== 'regional_manager') {
      throw new ForbiddenError('Org chart is restricted to Regional Manager and Admin');
    }

    if (actor.role === 'regional_manager') {
      // resolveScope() (auth/service.ts) only ever mints {type: 'global'}
      // for role === 'admin' -- a regional_manager always resolves to
      // 'hotel_group' or null. No 'global' branch here: that would be
      // granting a capability no token this role can hold actually needs,
      // and mirrors resolveNonAdminScopeFilter's own treatment of the same
      // case as an invariant violation, not a valid claim to allow.
      const scope = actor.scope ?? null;
      const ownsGroup = scope?.type === 'hotel_group' && scope.hotel_group_id === hotelGroupId;
      if (!ownsGroup) {
        throw new ForbiddenError('Cannot view another group\'s org chart');
      }
    }

    const group = await this.prisma.hotelGroup.findUnique({
      where: { id: hotelGroupId },
      select: {
        id: true,
        name: true,
        regional_manager: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
        hotels: {
          where: { deleted_at: null },
          select: {
            id: true,
            name: true,
            manager: { select: { id: true, first_name: true, last_name: true, email: true } },
          },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundError('Hotel group not found');

    // Group-grain, not hotel-grain (REQ-EMP-012): EmploymentRecord has no
    // hotel_id, so employees are listed once under the group -- they are
    // NOT nested under any one hotel in `hotels` above, since the data model
    // doesn't associate them with one. No status filter: REQ-EMP-013's own
    // acceptance text ("Regional Manager sees employee data across their
    // group") names no lifecycle-status carve-out, so this returns every
    // non-deleted record and includes `status` in the response -- filtering
    // to a particular status (e.g. only ACTIVE) is a consumer-side choice,
    // not something this endpoint should decide unasked.
    const employees = await this.prisma.employmentRecord.findMany({
      where: { hotel_group_id: hotelGroupId, deleted_at: null },
      select: {
        employee_id: true,
        job_title: true,
        status: true,
        user: { select: { id: true, first_name: true, last_name: true } },
      },
    });

    await this.logAudit(actor.userId, actor.role, 'employee.org_chart.view', 'HOTEL_GROUP', group.id, {});

    return {
      hotel_group_id: group.id,
      name: group.name,
      regional_manager: group.regional_manager,
      // Hotels within the group, each with their Hotel Manager (may be
      // null). Employees are listed separately below -- they are
      // group-scoped, not hotel-scoped; do not assume they belong to any
      // one entry in this array.
      hotels: group.hotels,
      // Group-scoped, not hotel-scoped (see note above and REQ-EMP-012).
      employees: employees.map((e) => ({
        employee_id: e.employee_id,
        job_title: e.job_title,
        status: e.status,
        user: e.user,
      })),
    };
  }

  // ── Review Queue (IF-EMP-ReviewQueue, ADR-065 §6 item 7) ────────────────
  //
  // 2026-08-13 routing fix: previously scoped by the APPLICANT's own target
  // hotel/group (a manager saw applications targeting their hotel, an RM
  // saw applications targeting their group). That is a peer/self review --
  // the same manager who created a worker's application could also be the
  // one reviewing it. The corrected rule routes to the CREATOR's own
  // superior instead, one level up the creation hierarchy
  // (lib/role-hierarchy.ts: manager creates worker/checker, regional_manager
  // creates manager, admin creates regional_manager):
  //   - a manager-created application (worker/checker) routes to that
  //     manager's own Regional Manager (Hotel.manager_user_id ->
  //     hotel_group_id -> HotelGroup.regional_manager_user_id) -- NOT back
  //     to the creating manager itself, and not to admin unless no RM is
  //     assigned yet.
  //   - a regional_manager-created application (manager) routes to admin
  //     (no stored level exists above RM other than admin).
  //   - an admin-created application (regional_manager) -- and any record
  //     with no created_by_id at all (legacy rows predating this column,
  //     or a manager whose hotel has no RM assigned yet) -- routes to admin
  //     as the fallback superior/reviewer of last resort.
  // A `manager` actor therefore never has anything in their own queue under
  // this rule (they are never anyone's "creator's superior") -- the route
  // stays reachable for that role (no 403) but always resolves empty,
  // rather than silently 403ing a nav entry that used to show results.
  async getReviewQueue(actor: AuthContext) {
    if (!['admin', 'manager', 'regional_manager'].includes(actor.role)) {
      throw new ForbiddenError('Role not authorized for review queue');
    }
    if (actor.role === 'regional_manager' && actor.scope?.type !== 'hotel_group') {
      throw new ForbiddenError('Regional Manager must be scoped to a hotel group');
    }
    // NOTE: this deliberately no longer refuses a Regional Manager.
    //
    // A previous fix threw here while FEATURE_RM_ROLE was off, because routing
    // withheld every record from RMs and the resulting empty queue read as "no
    // applications waiting". That was the right answer to the wrong problem:
    // the RM review path is no longer flag-gated at all (see
    // assertLifecycleAuthority), so an RM now legitimately owns records and
    // must be able to open this queue. Keeping the refusal would lock them out
    // of the very work they were just given.

    const records = await this.prisma.employmentRecord.findMany({
      where: {
        status: EmploymentStatus.PENDING,
        submitted_for_review_at: { not: null },
        deleted_at: null,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            phone: true,
            profile_photo_key: true,
            role: true,
            created_at: true,
            updated_at: true,
          },
        },
        created_by: {
          select: { id: true, email: true, first_name: true, last_name: true, role: true },
        },
      },
      orderBy: { submitted_for_review_at: 'asc' },
    });

    // 2026-08-13 routing rewrite (reported: "why is admin seeing all the
    // review requests"). The queue is now filtered by the SAME resolver that
    // decides who gets notified (resolveReviewerRecipients), applied per
    // record, instead of a second set of hand-written Prisma predicates.
    //
    // The two had already drifted: the queue gave a manager-created worker
    // application to the creating manager, while the notification for that
    // exact record went to that manager's Regional Manager -- so the person
    // who could act never heard about it, and the person told about it saw an
    // empty queue. Admin, meanwhile, claimed every record with an ADMIN
    // creator, which under ADR-065 (an account's EmploymentRecord is created
    // by whoever creates the account, and admin creates most accounts) is
    // nearly all of them.
    //
    // Routing is now by WHO THE APPLICANT IS and WHERE THEY ARE HEADED, not
    // by who typed the account in:
    //   Regional Manager applicant -> Admin
    //   Manager applicant          -> the RM of their target group (Admin if
    //                                 none, or while the RM role is disabled)
    //   Worker/Checker applicant   -> the manager of their target hotel, else
    //                                 that group's RM, else Admin
    // Exactly one queue owns each record, and an applicant is never their own
    // reviewer. Admin remains the reviewer of last resort, which is the only
    // reason an admin should see a front-line application at all.
    const owned = await Promise.all(
      records.map(async (record) => ({
        record,
        reviewerIds: await this.resolveReviewerRecipients(record, record.user.role),
      })),
    );
    const visible = owned
      .filter(({ reviewerIds }) => reviewerIds.includes(actor.userId))
      .map(({ record }) => record);

    return this.decorateReviewQueue(visible);
  }

  /**
   * Attaches the facts the reviewer's decision depends on, in ONE query for
   * the whole page: whether this is a returning employee (employment_cycle
   * > 1) and whether their contract still stands. Fetching these per row in
   * the UI would fire N contract requests and make the reviewer's button
   * label flicker as they resolved.
   *
   * `contract_signed_uploaded` covers BOTH upload paths (the applicant's own
   * CONTRACT_SCAN document and a manager-posted scan) -- see
   * hr/service.ts#findSignedScanDocumentId. Approving confirms that scan, so
   * the reviewer's Approve button must be enabled on it, not only on an
   * already-confirmed contract.
   */
  private async decorateReviewQueue<T extends EmploymentRecord>(records: T[]) {
    const userIds = records.map((r) => r.user_id);
    const [contracts, signedScans] = await Promise.all([
      userIds.length
        ? this.prisma.contract.findMany({
            where: { worker_id: { in: userIds } },
            orderBy: { created_at: 'desc' },
            select: { worker_id: true, status: true, expires_at: true, end_date: true, created_at: true, scanned_document_id: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.workerDocument.findMany({
            where: { worker_id: { in: userIds }, category: 'CONTRACT_SCAN' },
            orderBy: { created_at: 'desc' },
            select: { worker_id: true, created_at: true },
          })
        : Promise.resolve([]),
    ]);

    // findMany returns newest-first, so the FIRST hit per worker is the
    // newest -- which is the one that governs (matches
    // assertApprovedContract/ensureValidContract's own ordering).
    const newestByWorker = new Map<string, (typeof contracts)[number]>();
    for (const c of contracts) {
      if (!newestByWorker.has(c.worker_id)) newestByWorker.set(c.worker_id, c);
    }
    const newestScanByWorker = new Map<string, Date>();
    for (const d of signedScans) {
      if (!newestScanByWorker.has(d.worker_id)) newestScanByWorker.set(d.worker_id, d.created_at);
    }

    return records.map((record) => {
      const contract = newestByWorker.get(record.user_id) ?? null;
      const scanAt = newestScanByWorker.get(record.user_id) ?? null;
      const signedUploaded =
        !!contract && (contract.scanned_document_id != null || (scanAt != null && scanAt >= contract.created_at));
      return {
        ...toGeneralProfile(record),
        is_reonboarding: record.employment_cycle > 1,
        contract_status: contract?.status ?? null,
        contract_valid: isContractValid(contract),
        contract_signed_uploaded: signedUploaded,
        contract_end_date: contract?.end_date ? contract.end_date.toISOString().slice(0, 10) : null,
      };
    });
  }

  /**
   * THE routing authority for onboarding review: who reviews this
   * application. getReviewQueue() filters its rows with this, and
   * submitForReview() notifies exactly this set -- one function, so the queue
   * a record lands in and the person told about it cannot disagree. (They
   * previously did: a manager-created worker application sat in the creating
   * manager's queue while the notification went to that manager's Regional
   * Manager.)
   *
   * Routing is by WHO THE APPLICANT IS and WHERE THEY ARE HEADED, not by who
   * created the account -- under ADR-065 the creator is simply whoever typed
   * the account in, which is usually an admin and is not a statement about
   * who should vet the person:
   *
   *   Regional Manager applicant -> Admin(s)
   *   Manager applicant          -> the RM of their target group; Admin when
   *                                 no RM is assigned or the RM role is off
   *   Worker/Checker applicant   -> the manager of their target hotel, else
   *                                 that group's RM, else Admin(s)
   *
   * An applicant is never their own reviewer (a self-created or
   * self-targeting record falls through to the next level up), and Admin is
   * the reviewer of last resort so no submitted application can become
   * invisible to everyone.
   *
   * Best-effort for the notification caller: an empty result means nobody is
   * notified, never an error -- a missing notification must not block a
   * submission.
   */
  private async resolveReviewerRecipients(
    record: EmploymentRecord,
    applicantRole?: UserRole
  ): Promise<string[]> {
    const admins = async () =>
      (
        await this.prisma.user.findMany({
          where: { role: UserRole.ADMIN, is_active: true, deleted_at: null },
          select: { id: true },
        })
      ).map((u) => u.id);

    const role =
      applicantRole ??
      (
        await this.prisma.user.findUnique({
          where: { id: record.user_id },
          select: { role: true },
        })
      )?.role;

    // The creator reviews what they created (owner decision, 2026-08-14).
    //
    // This routes BY HIERARCHY rather than around it. RULE A
    // (lib/role-hierarchy.ts) already enforces "create is 1-level-down only"
    // at creation time -- admin -> regional_manager -> manager ->
    // worker/checker -- so the creator always outranks the applicant by
    // exactly one level. Routing to them therefore cannot produce a peer
    // approval (a manager can never have created another manager) and cannot
    // route someone their own application (nobody creates their own account).
    // canCreateRole() is re-checked here rather than assumed, so a record
    // predating RULE A, or one whose creator has since changed role, falls
    // through instead of handing review to someone who no longer outranks the
    // applicant.
    //
    // Falls through to the target-group routing below when the creator is
    // unknown (created_by_id is SetNull on user deletion) or deactivated.
    const creatorId = record.created_by_id;
    if (creatorId && creatorId !== record.user_id && role) {
      const creator = await this.prisma.user.findUnique({
        where: { id: creatorId },
        select: { id: true, role: true, is_active: true, deleted_at: true },
      });
      if (
        creator &&
        creator.is_active &&
        !creator.deleted_at &&
        canCreateRole(creator.role, role)
      ) {
        return [creator.id];
      }
    }

    if (!role || role === UserRole.ADMIN || role === UserRole.REGIONAL_MANAGER) {
      return admins();
    }

    const groupId = record.target_hotel_group_id ?? record.hotel_group_id ?? null;

    const regionalManagerId = async (): Promise<string | null> => {
      // No FEATURE_RM_ROLE gate: the RM review path is no longer flag-gated
      // (see assertLifecycleAuthority), so withholding records here would
      // route work away from the only role allowed to do it.
      if (!groupId) return null;
      const group = await this.prisma.hotelGroup.findUnique({
        where: { id: groupId },
        select: { regional_manager_user_id: true },
      });
      const rmId = group?.regional_manager_user_id ?? null;
      // Never route someone their own application.
      return rmId && rmId !== record.user_id ? rmId : null;
    };

    if (role === UserRole.MANAGER) {
      const rmId = await regionalManagerId();
      return rmId ? [rmId] : admins();
    }

    // WORKER / CHECKER: their hotel's manager owns the review.
    const hotelId = record.target_primary_hotel_id ?? record.primary_hotel_id ?? null;
    if (hotelId) {
      const hotel = await this.prisma.hotel.findUnique({
        where: { id: hotelId },
        select: { manager_user_id: true },
      });
      const managerId = hotel?.manager_user_id ?? null;
      if (managerId && managerId !== record.user_id) return [managerId];
    }

    const rmId = await regionalManagerId();
    return rmId ? [rmId] : admins();
  }

  /**
   * Fire-and-forget notification helper for the onboarding lifecycle.
   *
   * Always best-effort: a notification failure must never roll back or block
   * the lifecycle transition that triggered it (the transition is the real
   * outcome; the notification is how someone finds out about it). Errors are
   * logged, never rethrown — the same posture HR's own notify helpers take.
   */
  private async notifyOnboarding(
    recipientIds: string[],
    type: 'ONBOARDING_SUBMITTED' | 'ONBOARDING_APPROVED' | 'ONBOARDING_REJECTED',
    title: string,
    message: string,
    data: Record<string, unknown>
  ): Promise<void> {
    for (const recipientId of recipientIds) {
      try {
        await notificationService.enqueue({
          recipientId,
          type,
          title,
          message,
          data,
          transports: [OutboxTransport.PUSH, OutboxTransport.EMAIL],
          sourceModule: OutboxSourceModule.EMPLOYEE_MANAGEMENT,
          producerService: 'EmployeeManagementService',
        });
      } catch (error) {
        logger.error('employee_onboarding_notification_failed', {
          recipientId,
          type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Vacates any hotel/hotel-group this person currently heads.
   *
   * Extracted from deactivate() so delete() can reuse it verbatim. delete()
   * previously omitted this entirely (2026-08-13 audit finding, "manager
   * ghosting"): terminating a Hotel Manager soft-deleted their account but
   * left hotel.manager_user_id pointing at them forever. The hotel then read
   * as actively managed by a terminated employee, and assign() refused every
   * replacement with "Hotel already has a different manager assigned" -- the
   * hotel became unassignable without a manual database edit.
   *
   * `reason` differs by caller and is the whole point of parameterising
   * rather than hardcoding: a temporary pause is TEMPORARY, a termination is
   * TERMINATED, and the vacancy history rows must say which actually happened.
   */
  /**
   * Public so users/service.ts#deleteUser can reuse it on the path that does
   * NOT come through delete() above.
   *
   * That path is taken whenever the account has no live EmploymentRecord --
   * an admin, or a pre-ADR-065 account that never got one -- and it only
   * soft-deleted the User. So deleting a Manager or Regional Manager who held
   * a hotel or group left the assignment pointing at a deleted user: the
   * hotel group reported "already assigned" and its detail page could not
   * load the holder, because getUser refuses a soft-deleted row. Reported
   * live. Exported rather than duplicated -- the divergence between the two
   * delete paths IS this bug, and a second copy of the teardown would be the
   * same mistake again (see delete()'s own comment on the ghost-employee
   * fix).
   */
  async vacateManagedScopesForUser(
    tx: DatabaseTransaction,
    userId: string,
    actorUserId: string,
    now: Date
  ): Promise<void> {
    await this.vacateManagedScopes(tx, userId, actorUserId, 'TERMINATED', now);
  }

  private async vacateManagedScopes(
    tx: DatabaseTransaction,
    userId: string,
    actorUserId: string,
    reason: 'TEMPORARY' | 'TERMINATED',
    now: Date
  ): Promise<void> {
    const targetUser = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });

    if (targetUser?.role === 'MANAGER') {
      const ownedHotels = await tx.hotel.findMany({ where: { manager_user_id: userId }, select: { id: true } });
      for (const hotel of ownedHotels) {
        await tx.hotel.update({
          where: { id: hotel.id },
          data: { manager_user_id: null, manager_assigned_at: null, manager_vacated_at: now, manager_vacancy_reason: reason },
        });
        await tx.hotelManagerAssignmentHistory.updateMany({
          where: { hotel_id: hotel.id, manager_user_id: userId, unassigned_at: null },
          data: { unassigned_at: now, unassigned_by_id: actorUserId, reason },
        });
      }
    } else if (targetUser?.role === 'REGIONAL_MANAGER') {
      const ownedGroup = await tx.hotelGroup.findUnique({ where: { regional_manager_user_id: userId }, select: { id: true } });
      if (ownedGroup) {
        await tx.hotelGroup.update({
          where: { id: ownedGroup.id },
          data: { regional_manager_user_id: null, regional_manager_assigned_at: null, regional_manager_vacated_at: now, regional_manager_vacancy_reason: reason },
        });
        await tx.regionalManagerAssignmentHistory.updateMany({
          where: { hotel_group_id: ownedGroup.id, regional_manager_user_id: userId, unassigned_at: null },
          data: { unassigned_at: now, unassigned_by_id: actorUserId, reason },
        });
      }
    }
  }


  // ── By-user lookup (IF-EMP-GetByUserId) ─────────────────────────────────

  // resolves whether `userId` already has an EmploymentRecord, keyed by the
  // FK every other module already joins on (roster-scope.ts, scope.ts,
  // hr/service.ts, etc.) rather than this module's own `employee_id`. Returns
  // `null` (not a 404) when no record exists — "not yet onboarded" is the
  // expected state for a freshly-created worker, matching
  // `HrService.getContractStatus`'s `ContractDto | null` convention for the
  // same "may legitimately not exist yet" shape. Excludes soft-deleted
  // records (`deleted_at`) so a deactivated employment history doesn't
  // resurface as if it were still live — same invariant `findRecordOrThrow`
  // now enforces below.
  async getByUserId(
    actor: AuthContext,
    userId: string
  ): Promise<Omit<EmploymentRecord, 'konfession' | 'disability_status'> | null> {
    const record = await this.prisma.employmentRecord.findUnique({ where: { user_id: userId } });
    if (!record || record.deleted_at) return null;

    await this.assertVisibility(actor, record);
    return toGeneralProfile(record);
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  // Deliberately does NOT filter on deleted_at (and never did, despite
  // getByUserId's comment above claiming it "now enforces" that invariant --
  // getByUserId does its own filtering, which is what actually holds). Kept
  // as-is: restore() must be able to resolve a DELETED, soft-deleted record
  // by employee_id, which a deleted_at filter here would make impossible.
  private async findRecordOrThrow(employeeId: string): Promise<EmploymentRecord> {
    const record = await this.prisma.employmentRecord.findUnique({ where: { employee_id: employeeId } });
    if (!record) throw new NotFoundError('Employment record not found');
    return record;
  }

  private assertValidSkills(skills: SkillTag[]): void {
    const valid = new Set<string>(Object.values(SkillTag));
    for (const tag of skills) {
      if (!valid.has(tag)) {
        throw new ValidationError('Invalid skill tag', [
          { field: 'skills', message: `${tag} is not a recognized skill tag` },
        ]);
      }
    }
  }

  // REQ-EMP-013 / RULE-EMP-08: deny-by-default visibility. Worker sees only
  // self; Admin sees all; Manager/Regional Manager/Checker are bound to their
  // PR 5.4 JWT `scope` claim (group-grain, per REQ-EMP-012 — never filtered by
  // hotel directly).
  //
  // `regional_manager` reaches the scope branch via isScopedManagerRole().
  // It was previously absent from this list, so an RM fell through to the
  // terminal throw and was denied on `/employees/:id/profile`, `/skills` and
  // `/by-user/:user_id` for employees in its OWN group — contradicting
  // ADR-030 §3 C-19 (RM `✓ᶜ`), which this same class already honours for the
  // org chart a few methods above. isRecordInScope() is role-agnostic and
  // group-grain, so it serves an RM's hotel_group claim with no change.
  private async assertVisibility(actor: AuthContext, record: EmploymentRecord): Promise<void> {
    if (actor.role === 'worker') {
      if (record.user_id !== actor.userId) {
        throw new ForbiddenError('Workers may only view their own profile');
      }
      return;
    }
    if (actor.role === 'admin') return;
    // ADR-065 self-service: a Manager/RM applicant's own record has no
    // hotel_group_id/scope claim yet (both are set only on activation), so
    // the group-scope check below always denies self-reads pre-assignment.
    // Own-record access must be checked before the scope branch, the same
    // ordering assertLifecycleAuthority already uses for self-submission.
    if (record.user_id === actor.userId) return;
    if (isScopedManagerRole(actor.role) || actor.role === 'checker') {
      const allowed = await this.isRecordInScope(actor, record);
      if (!allowed) throw new ForbiddenError('Record is outside your scope');
      return;
    }
    throw new ForbiddenError('Insufficient permissions');
  }

  private async isRecordInScope(actor: AuthContext, record: EmploymentRecord): Promise<boolean> {
    const scope = actor.scope ?? null;
    if (!scope) return false; // deny-by-default (no scope claim)
    if (scope.type === 'global') return true;

    // 2026-08-24: a PENDING record has no hotel_group_id — that is set only on
    // activation (ADR-065 Decision 2) — so every branch below denied it, and a
    // Manager could not read the applicant they had just created. The UI
    // redirects to that applicant's page on create, which therefore rendered
    // "Failed to load employment status" immediately after a successful 201.
    //
    // target_hotel_group_id/target_primary_hotel_id are set at creation from
    // the CREATING actor's own scope, and are the pre-approval equivalent of
    // hotel_group_id for exactly this question: may this reviewer VIEW a
    // not-yet-approved applicant. Same reasoning, and same fallback order, as
    // lib/scope.ts's isWorkerInReviewerScope(), which was added for the
    // review-queue instance of this identical gap on 2026-08-13.
    //
    // Safe to widen here because every caller of assertVisibility() is a READ
    // (getByUserId, getSkills, getProfileHistory). The fallback applies only
    // while hotel_group_id is null, so it can never widen access to an
    // already-activated record whose real group differs from a stale target.
    if (!record.hotel_group_id) {
      return this.isPendingRecordInReviewerScope(scope, record);
    }

    if (scope.type === 'hotel_group') {
      return record.hotel_group_id === scope.hotel_group_id;
    }
    // scope.type === 'hotel': REQ-EMP-012 — employees are group-grain, not
    // hotel-grain. Resolve the hotel's group (one findUnique) and match on
    // that; never filter employment records by hotel directly.
    const hotel = await this.prisma.hotel.findUnique({
      where: { id: scope.hotel_id },
      select: { hotel_group_id: true },
    });
    return !!hotel && hotel.hotel_group_id === record.hotel_group_id;
  }

  /**
   * Read-only visibility for a not-yet-approved record, resolved from its
   * `target_*` fields. Never call this for a record that already has a
   * `hotel_group_id` — that one has a real group and must use it.
   */
  private async isPendingRecordInReviewerScope(
    scope: NonNullable<AuthContext['scope']>,
    record: EmploymentRecord
  ): Promise<boolean> {
    if (scope.type === 'hotel_group') {
      if (record.target_hotel_group_id) {
        return record.target_hotel_group_id === scope.hotel_group_id;
      }
      // Target recorded at hotel grain only (a Manager-created applicant seen
      // by their RM): resolve the hotel's group and compare on that.
      if (record.target_primary_hotel_id) {
        const hotel = await this.prisma.hotel.findUnique({
          where: { id: record.target_primary_hotel_id },
          select: { hotel_group_id: true },
        });
        return !!hotel && hotel.hotel_group_id === scope.hotel_group_id;
      }
      return false;
    }

    if (scope.type === 'hotel') {
      if (record.target_primary_hotel_id === scope.hotel_id) return true;
      // Group-grain target (an RM-created applicant) vs a hotel-scoped
      // manager: match through the hotel's own group, mirroring the
      // group-grain rule the activated path uses.
      if (record.target_hotel_group_id) {
        const hotel = await this.prisma.hotel.findUnique({
          where: { id: scope.hotel_id },
          select: { hotel_group_id: true },
        });
        return !!hotel && hotel.hotel_group_id === record.target_hotel_group_id;
      }
      return false;
    }

    return false;
  }

  /**
   * Resolves the contract this record should be reviewed against, issuing a
   * fresh one when re-onboarding finds the previous one expired.
   *
   * Returns the newest contract if one exists and is either still valid or
   * still PENDING (i.e. already awaiting signature — issuing a second one
   * would just create two unsigned contracts for the same person). Otherwise,
   * when every contract on file has EXPIRED, generates a new PENDING one on
   * the same default terms a first-time hire gets, so the returning employee
   * has something current to sign.
   *
   * Returns null only when contract generation itself is unavailable, which
   * submitForReview() surfaces as a "contact an administrator" conflict
   * rather than silently proceeding without a contract.
   */
  private async ensureValidContract(record: EmploymentRecord) {
    const latest = await this.prisma.contract.findFirst({
      where: { worker_id: record.user_id },
      orderBy: { created_at: 'desc' },
    });

    if (latest && (latest.status === ContractStatus.PENDING || isContractValid(latest))) {
      return latest;
    }

    // No contract at all, or the newest one has expired -> issue a fresh
    // PENDING contract. generateDefaultContract() is idempotent per worker
    // ONLY while a contract exists, so the expired-contract path needs the
    // explicit re-issue below rather than that method's short-circuit.
    try {
      if (!latest) {
        await hrService.generateDefaultContract(
          record.user_id,
          record.job_title,
          record.start_date,
          record.employment_type
        );
      } else {
        await hrService.reissueDefaultContract(
          record.user_id,
          record.job_title,
          record.start_date,
          record.employment_type
        );
      }
    } catch (error) {
      logger.error('employee_reonboarding_contract_issue_failed', {
        userId: record.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    return this.prisma.contract.findFirst({
      where: { worker_id: record.user_id },
      orderBy: { created_at: 'desc' },
    });
  }

  // 2026-08-13 re-onboarding: now checks EXPIRY too, not just status.
  // Previously this matched on status alone, so a contract that was ACTIVE
  // but years past its expires_at still satisfied the approve/rehire gate --
  // nothing in this codebase ever transitions a contract out of ACTIVE when
  // it lapses (hr/service.ts sendExpiryReminders only notifies), so that was
  // reachable in normal operation, not a corner case. Uses the shared
  // isContractValid() predicate rather than a second copy of the rule.
  private async assertApprovedContract(userId: string): Promise<void> {
    const contract = await this.prisma.contract.findFirst({
      where: {
        worker_id: userId,
        status: { in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED, ContractStatus.PERMANENT] },
      },
      orderBy: { created_at: 'desc' },
      select: { id: true, status: true, expires_at: true },
    });
    if (!isContractValid(contract)) {
      throw new ConflictError(
        contract
          ? 'Cannot approve: the worker\'s contract has expired. Issue and confirm a new contract in HR first.'
          : 'Cannot approve: the worker does not have an approved contract (Active, Extended, or Permanent). Please confirm their contract in HR first.',
      );
    }
  }
}

export const employeeManagementService = new EmployeeManagementService();

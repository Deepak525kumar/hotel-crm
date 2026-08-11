import {
  AssignmentStatus,
  ContractStatus,
  DeactivationReason,
  EmploymentStatus,
  EmploymentRecord,
  Prisma,
  SkillTag,
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
import type { AuthContext } from '../../lib/types.js';
import { bumpTokenGeneration } from '../auth/service.js';
import { ACTIVE_ASSIGNMENT_STATUSES, assignmentService } from '../assignments/service.js';
import { documentService } from '../documents/service.js';
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
  const profile: Partial<EmploymentRecord> = { ...record };
  delete profile.konfession;
  delete profile.disability_status;
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
    if (actor.role !== 'admin') {
      throw new ForbiddenError('Only Admin may create employment records');
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
          skills: data.skills ?? [],
          personal_data: data.personal_data
            ? (data.personal_data as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });

      await this.logAudit(actor.userId, actor.role, 'employee.create', 'EMPLOYMENT_RECORD', createdRecord.id, {
        employee_id: createdRecord.employee_id,
      }, undefined, undefined, undefined, tx);

      return createdRecord;
    });

    return toGeneralProfile(record);
  }

  // REQ-EMP-006 / RULE-EMP-10: bulk import routes each row through the same
  // path as manual creation, starting Inactive. Per-row isolation: a failing
  // row (validation or duplicate) does not affect any other row. Row-level
  // duplicate/invalid-row semantics beyond isolation remain OPEN (OD-EMP-08).
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
        this.prisma.rating.findMany({
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
    }
  ): Promise<EmploymentRecord> {
    assertTransition(record.status, toStatus);

    const isRehire =
      record.status === EmploymentStatus.DELETED && toStatus === EmploymentStatus.PENDING;
    const nextCycle = isRehire ? record.employment_cycle + 1 : record.employment_cycle;

    const updated = await tx.employmentRecord.update({
      where: { id: record.id },
      data: {
        ...(opts.data ?? {}),
        status: toStatus,
        ...(isRehire ? { employment_cycle: nextCycle } : {}),
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

    if (record.status !== EmploymentStatus.PENDING) {
      throw new ConflictError('Only a Pending employment record may be submitted for review');
    }

    // GATE: All required documents must be uploaded before onboarding can be
    // submitted for review. Work permit requirement is derived from the
    // personal_data.nationality field — if nationality is missing/unknown,
    // we conservatively treat it as NOT required so a partial profile doesn't
    // permanently block submission. An admin reviewer can still catch it.
    const personalData = record.personal_data as Record<string, unknown> | null;
    const nationality = typeof personalData?.nationality === 'string' ? personalData.nationality : null;
    const isWorkPermitRequired = nationality !== null && nationality.toLowerCase() !== 'german' && nationality.toLowerCase() !== 'de';

    const completeness = await documentService.getDocumentCompleteness(record.user_id, isWorkPermitRequired);
    if (!completeness.is_complete) {
      throw new ConflictError(
        `Cannot submit for review: required documents are missing (${completeness.missing_categories.join(', ')}). Please upload all required documents first.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const transitionedRecord = await tx.employmentRecord.update({
        where: { id: record.id },
        data: { submitted_for_review_at: new Date() },
      });

      await this.logAudit(
        actor.userId,
        actor.role,
        'employee.lifecycle.submitted_for_review',
        'EMPLOYMENT_RECORD',
        record.id,
        { submitted_for_review_at: transitionedRecord.submitted_for_review_at },
        undefined, undefined, undefined, tx
      );

      return transitionedRecord;
    });

    this.logDomainEvent('EVT-EMP-submitted_for_review', record.employee_id, EmploymentStatus.PENDING);

    return toGeneralProfile(updated);
  }

  /**
   * PENDING -> ACTIVE (hire approval).
   *
   * ADR-023 §4's group resolution is unchanged in substance, only in
   * placement: it now runs inside the transition's transaction so the
   * resolved hotel_group_id and the ACTIVE status commit together — an
   * approval can no longer half-apply (status ACTIVE, group unset) if the
   * connect fails. Resolution order: (1) the actor's own HotelGroup as its
   * Regional Manager, (2) the group of a Hotel the actor manages, (3) an
   * explicit hotel_group_id in the payload. If none resolve, hotel_group_id
   * is left null — PROVISIONAL, unchanged from the pre-rework behavior: the
   * record becomes Active but unassignable until a group is set.
   */
  async approve(actor: AuthContext, employeeId: string, payload?: { hotel_group_id?: string }) {
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

    await this.assertApprovedContract(record.user_id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const resolvedGroupId = await this.resolveApprovalGroupId(actor, payload?.hotel_group_id);
      const transitionedRecord = await this.applyTransition(tx, record, EmploymentStatus.ACTIVE, {
        actorUserId: actor.userId,
        data: resolvedGroupId ? { hotel_group: { connect: { id: resolvedGroupId } } } : {},
      });

      await this.logAudit(actor.userId, actor.role, 'employee.lifecycle.approved', 'EMPLOYMENT_RECORD', record.id, {
        from: record.status,
        to: EmploymentStatus.ACTIVE,
        hotel_group_id: transitionedRecord.hotel_group_id,
      }, undefined, undefined, undefined, tx);

      return transitionedRecord;
    });

    this.logDomainEvent('EVT-EMP-approved', record.employee_id, EmploymentStatus.ACTIVE);

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
    if (actor.role !== 'admin') {
      throw new ForbiddenError('Only Admin may delete an employee');
    }

    if (!deletedReason || !deletedReason.trim()) {
      throw new ValidationError('deleted_reason is required', [
        { field: 'deleted_reason', message: 'Reason must not be blank' },
      ]);
    }
    const reason = deletedReason.trim();

    const record = await this.findRecordOrThrow(employeeId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const result = await this.applyTransition(tx, record, EmploymentStatus.DELETED, {
        actorUserId: actor.userId,
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
    if (actor.role === 'admin') return;

    if (isScopedManagerRole(actor.role)) {
      if (record.hotel_group_id === null && opts.allowUnassignedGroup) {
        const ownGroupId = await this.resolveApprovalGroupId(actor);
        if (!ownGroupId) {
          throw new ForbiddenError(`Cannot ${action}: you do not manage a hotel group`);
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

  // ── By-user lookup (IF-EMP-GetByUserId) ─────────────────────────────────

  // Resolves whether `userId` already has an EmploymentRecord, keyed by the
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
    return !!hotel && !!record.hotel_group_id && hotel.hotel_group_id === record.hotel_group_id;
  }

  private async assertApprovedContract(userId: string): Promise<void> {
    const approvedContract = await this.prisma.contract.findFirst({
      where: {
        worker_id: userId,
        status: { in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED, ContractStatus.PERMANENT] },
      },
      select: { id: true },
    });
    if (!approvedContract) {
      throw new ConflictError(
        'Cannot approve: the worker does not have an approved contract (Active, Extended, or Permanent). Please confirm their contract in HR first.',
      );
    }
  }
}

export const employeeManagementService = new EmployeeManagementService();

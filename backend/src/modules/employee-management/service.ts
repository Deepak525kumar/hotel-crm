import { EmploymentStatus, EmploymentRecord, Prisma, SkillTag } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { isScopedManagerRole } from '../../lib/scope.js';
import type { AuthContext } from '../../lib/types.js';
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
  LifecycleSignal,
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

    const record = await this.prisma.employmentRecord.create({
      data: {
        user_id: data.user_id,
        employee_id: data.employee_id,
        job_title: data.job_title,
        start_date: data.start_date,
        status: EmploymentStatus.INACTIVE,
        skills: data.skills ?? [],
        personal_data: data.personal_data
          ? (data.personal_data as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    await this.logAudit(actor.userId, actor.role, 'employee.create', 'EMPLOYMENT_RECORD', record.id, {
      employee_id: record.employee_id,
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
  async getBlocklist(_actor: AuthContext, filters: { hotelId?: string; employeeId?: string }) {
    const where: Prisma.EmployeeBlocklistEntryWhereInput = {};
    if (filters.hotelId) where.hotel_id = filters.hotelId;
    if (filters.employeeId) {
      const record = await this.findRecordOrThrow(filters.employeeId);
      where.employment_record_id = record.id;
    }
    return this.prisma.employeeBlocklistEntry.findMany({ where, orderBy: { created_at: 'desc' } });
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

  // IF-EMP-Deactivate / v0 (Admin-driven soft delete; history retained).
  async deactivate(actor: AuthContext, employeeId: string) {
    if (actor.role !== 'admin') {
      throw new ForbiddenError('Only Admin may deactivate an employee');
    }
    const record = await this.findRecordOrThrow(employeeId);
    assertTransition(record.status, EmploymentStatus.DEACTIVATED);

    const updated = await this.prisma.employmentRecord.update({
      where: { id: record.id },
      data: { status: EmploymentStatus.DEACTIVATED, deleted_at: new Date() },
    });

    await this.logAudit(actor.userId, actor.role, 'employee.deactivate', 'EMPLOYMENT_RECORD', record.id, {});
    return toGeneralProfile(updated);
  }

  // ADR-045 (2026-07-28, resolving OD-EMP-04): HR implementation PR 5. A
  // narrow, purpose-built internal method for backend-hr's contract-lapse
  // trigger (ADR-040: manager-confirmed "do not continue" action, or
  // manager silence past a deadline detected by HR's own scheduled job —
  // both call this the same way). No actor.role gate, unlike deactivate()/
  // lifecycleSignal() above: this is an internal cross-module call, not a
  // user-facing route, and ADR-040's manager-only/scheduled-job rules
  // already gate the caller (backend-hr) before this method is ever
  // reached — mirroring the same authorization-boundary shape ADR-032
  // established for every other direct in-process cross-module call on this
  // platform (the caller's own authz, not a second check here). Keyed by
  // user_id (backend-hr only holds Contract.worker_id, a User.id), not
  // employee_id like findRecordOrThrow() above -- HR has no reason to know
  // employee-management's own human-facing employee_id.
  async deactivateForContractLapse(userId: string, reason: string): Promise<void> {
    const record = await this.prisma.employmentRecord.findUnique({ where: { user_id: userId } });
    if (!record) return; // no employment record to deactivate -- nothing to do (best-effort, matches OD-CAL-06 precedent)
    if (record.status === EmploymentStatus.DEACTIVATED) return; // idempotent -- already deactivated

    assertTransition(record.status, EmploymentStatus.DEACTIVATED);

    await this.prisma.employmentRecord.update({
      where: { id: record.id },
      data: { status: EmploymentStatus.DEACTIVATED, deleted_at: new Date() },
    });

    await this.logAudit(null, 'system', 'employee.deactivate.contract_lapse', 'EMPLOYMENT_RECORD', record.id, {
      reason,
    });

    logger.info('domain_event', { event: 'EVT-EMP-deactivated', employmentRecordId: record.id, reason });
  }

  // ── Lifecycle signal (internal, Onboarding-driven) ──────────────────────

  private static readonly SIGNAL_TARGET: Record<LifecycleSignal, EmploymentStatus> = {
    submitted_for_review: EmploymentStatus.UNDER_REVIEW,
    approved: EmploymentStatus.ACTIVE,
    rejected: EmploymentStatus.REJECTED,
  };

  // IF-EMP-LifecycleSignal / v0: Onboarding-driven transitions. No dedicated
  // service-to-service auth mechanism exists in this codebase, so the
  // transport boundary is Admin-only at the route (OD-EMP-09).
  async lifecycleSignal(
    actor: AuthContext,
    employeeId: string,
    signal: LifecycleSignal,
    payload?: { hotel_group_id?: string }
  ) {
    if (actor.role !== 'admin') {
      throw new ForbiddenError('Lifecycle signals are internal-only');
    }

    const record = await this.findRecordOrThrow(employeeId);
    const target = EmployeeManagementService.SIGNAL_TARGET[signal];
    assertTransition(record.status, target);

    const data: Prisma.EmploymentRecordUpdateInput = { status: target };

    if (signal === 'approved') {
      // ADR-023 §4: hotel_group_id is set at Under Review -> Active from the
      // approving manager's own group. Resolution order: (1) the actor's own
      // HotelGroup as its Regional Manager, (2) the group of a Hotel the
      // actor manages, (3) an explicit hotel_group_id in the payload. If
      // none resolve, hotel_group_id is left null — PROVISIONAL, the record
      // becomes Active but unassignable until a group is set by a follow-up
      // action outside this PR's scope.
      const resolvedGroupId = await this.resolveApprovalGroupId(actor, payload?.hotel_group_id);
      if (resolvedGroupId) {
        data.hotel_group = { connect: { id: resolvedGroupId } };
      }
    }

    const updated = await this.prisma.employmentRecord.update({ where: { id: record.id }, data });

    await this.logAudit(actor.userId, actor.role, `employee.lifecycle.${signal}`, 'EMPLOYMENT_RECORD', record.id, {
      from: record.status,
      to: target,
    });

    // OD-EMP-09: no event bus exists in this codebase (every module records
    // published_events: none-observed); domain events are represented as a
    // structured log line only.
    logger.info('domain_event', {
      event: `EVT-EMP-${signal}`,
      employee_id: record.employee_id,
      status: target,
    });

    return toGeneralProfile(updated);
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
}

export const employeeManagementService = new EmployeeManagementService();

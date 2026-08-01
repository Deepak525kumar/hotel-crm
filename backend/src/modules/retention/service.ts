import { BaseService } from '../../lib/base-service.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  RETENTION_TIER_WINDOWS,
  type RegisterCategoryInput,
  type TagRecordInput,
  type GetDeletionAuditLogQuery,
  type RetentionCategoryDto,
  type RetentionLogDto,
  type RetentionAuditEntryDto,
} from './types.js';

// SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN). PR 2/4 of 5: RetentionService
// interfaces -- PR 2: IF-RETENTION-RegisterCategory, IF-RETENTION-TagRecord.
// PR 4: IF-RETENTION-GetDeletionAuditLog, a read-only query over PR 3's
// sweep output. No route, controller, or scheduler code is introduced by
// this PR -- route wiring is PR 5's scope, alongside IF-RETENTION-
// CheckEligibility.
//
// Scope: generic retention infrastructure for consuming modules without their
// own retention mechanism. Does not own backend-geo's Tier-1 sweep
// (GeoRetentionSweepJob, SIR-GEO-002/OD-GEO-002, resolved by GD-14) -- see
// docs/03-modules/retention/MODULE_SPEC.md's Purpose and Scope /
// RULE-RETENTION-08.
export class RetentionService extends BaseService {
  // ---------------------------------------------------------------------------
  // IF-RETENTION-RegisterCategory (REQ-RETENTION-014/RULE-RETENTION-02)
  // ---------------------------------------------------------------------------
  // OD-RETENTION-03 (duplicate registration with a conflicting tier) is
  // explicitly OPEN in the spec -- this PR's disclosed implementation-time
  // default: re-registering an already-registered (module_id, category_id)
  // pair with the SAME tier is idempotent (a consuming module may safely call
  // this at every boot without tracking whether it already registered); a
  // DIFFERENT tier throws ConflictError rather than silently overwriting the
  // existing assignment, since a silent tier change would retroactively alter
  // every already-tagged record's retention window without any audit trail.
  // Mirrors ConsentService's "reject rather than silently accept an ambiguous
  // state" posture (recordDecision's stale-notice-version rejection).
  async registerCategory(input: RegisterCategoryInput): Promise<RetentionCategoryDto> {
    const existing = await this.prisma.retentionCategory.findUnique({
      where: {
        module_id_category_id: {
          module_id: input.module_id,
          category_id: input.category_id,
        },
      },
    });

    if (existing) {
      // OD-RETENTION-03 (open): rejecting a conflicting-tier re-registration,
      // rather than silently overwriting it, is this PR's own default -- see
      // the class comment above.
      if (existing.tier !== input.tier) {
        throw new ConflictError(
          `Category "${input.module_id}.${input.category_id}" is already registered under tier ${existing.tier}; re-registering under a different tier (${input.tier}) is not permitted.`
        );
      }
      return this.toCategoryDto(existing);
    }

    const category = await this.prisma.retentionCategory.create({
      data: {
        module_id: input.module_id,
        category_id: input.category_id,
        tier: input.tier,
      },
    });

    logger.info('retention_category_registered', {
      categoryId: category.id,
      moduleId: category.module_id,
      categoryKey: category.category_id,
      tier: category.tier,
    });

    return this.toCategoryDto(category);
  }

  // ---------------------------------------------------------------------------
  // IF-RETENTION-TagRecord (REQ-RETENTION-015/RULE-RETENTION-03/07)
  // ---------------------------------------------------------------------------
  // RULE-RETENTION-07: an unregistered category is never swept -- enforced
  // here by resolving the category first and throwing NotFoundError if it
  // was never registered, backstopping the schema's own FK constraint
  // (RetentionLog.category_id -> RetentionCategory.id) with a clear caller-
  // facing error instead of a raw Prisma FK-violation exception.
  //
  // OD-RETENTION-04 (per-record vs. category-level tagging granularity) is
  // explicitly OPEN -- this PR implements per-record tagging only (one
  // RetentionLog row per TagRecord call), the narrower of the two candidate
  // shapes the spec names; a future PR may add category-level/timestamp-query
  // sweep logic for tiers where per-record tagging proves impractical, without
  // this interface's own contract needing to change.
  async tagRecord(input: TagRecordInput): Promise<RetentionLogDto> {
    const category = await this.prisma.retentionCategory.findUnique({
      where: {
        module_id_category_id: {
          module_id: input.module_id,
          category_id: input.category_id,
        },
      },
    });

    // RULE-RETENTION-07: an unregistered category is never swept.
    if (!category) {
      throw new NotFoundError(
        `Category "${input.module_id}.${input.category_id}" is not registered; call IF-RETENTION-RegisterCategory before tagging a record.`
      );
    }

    const log = await this.prisma.retentionLog.create({
      data: {
        category_id: category.id,
        record_ref: input.record_ref,
        tagged_at: input.tagged_at,
      },
    });

    logger.info('retention_record_tagged', {
      logId: log.id,
      categoryId: category.id,
      moduleId: category.module_id,
      categoryKey: category.category_id,
    });

    return this.toLogDto(log);
  }

  // ---------------------------------------------------------------------------
  // IF-RETENTION-GetDeletionAuditLog (RULE-RETENTION-06, FIND-SEC-003)
  // ---------------------------------------------------------------------------
  // OD-RETENTION-05 (Admin RBAC scope) is explicitly OPEN in the spec --
  // "no implementation may grant Admin access to this interface" until it
  // resolves. This method therefore has NO actor/role parameter and NO
  // Admin caller class: every caller sees the same unrestricted read over
  // RetentionAuditEntry. Named spec-sanctioned consumers today are (a) a
  // consuming module's own trusted backend context, or (b) Compliance,
  // once it exists -- neither of which is an end-user-facing caller
  // needing per-caller scoping.
  //
  // This covers OD-RETENTION-05's Admin-RBAC gap only. The spec's separate,
  // still-binding Trust boundaries/authorization requirement -- every
  // IF-RETENTION-* interface's calling-module-identity parameter MUST be
  // derived from the caller's own already-authenticated context, never an
  // unverified client-supplied field -- is NOT enforced by this method
  // either, by the same design as registerCategory()/tagRecord() above: no
  // route/controller exists yet (PR 5's scope), so there is no unverified-
  // client-input path to enforce against today. PR 5 must derive any
  // future caller-identity parameter from its own auth middleware, not a
  // request-body field, when it wires this method to a route.
  //
  // Mirrors ConsentService.getAuditHistory()'s bounded/paginated shape;
  // unlike Consent's self-or-Admin worker scoping, this interface has no
  // "owning worker" concept to scope by -- audit rows are module/category
  // metadata, not a specific person's data (Data classification/retention
  // section: "metadata about other modules' personal data, not the
  // personal data itself").
  async getDeletionAuditLog(
    query: GetDeletionAuditLogQuery
  ): Promise<{ data: RetentionAuditEntryDto[]; total: number }> {
    const where = {
      ...(query.module_id ? { module_id: query.module_id } : {}),
      ...(query.category_id ? { category_id: query.category_id } : {}),
      ...(query.from || query.to
        ? {
            deleted_at: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [entries, total] = await Promise.all([
      this.prisma.retentionAuditEntry.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { deleted_at: 'desc' },
      }),
      this.prisma.retentionAuditEntry.count({ where }),
    ]);

    return { data: entries.map((e) => this.toAuditEntryDto(e)), total };
  }

  private toCategoryDto(category: {
    id: string;
    module_id: string;
    category_id: string;
    tier: RetentionCategoryDto['tier'];
  }): RetentionCategoryDto {
    return {
      id: category.id,
      module_id: category.module_id,
      category_id: category.category_id,
      tier: category.tier,
      window: RETENTION_TIER_WINDOWS[category.tier],
    };
  }

  private toLogDto(log: {
    id: string;
    category_id: string;
    record_ref: string;
    tagged_at: Date;
    deleted_at: Date | null;
  }): RetentionLogDto {
    return {
      id: log.id,
      category_id: log.category_id,
      record_ref: log.record_ref,
      tagged_at: log.tagged_at.toISOString(),
      deleted_at: log.deleted_at ? log.deleted_at.toISOString() : null,
    };
  }

  private toAuditEntryDto(entry: {
    id: string;
    module_id: string;
    category_id: string;
    tier: RetentionAuditEntryDto['tier'];
    deleted_at: Date;
  }): RetentionAuditEntryDto {
    return {
      id: entry.id,
      module_id: entry.module_id,
      category_id: entry.category_id,
      tier: entry.tier,
      deleted_at: entry.deleted_at.toISOString(),
    };
  }
}

export const retentionService = new RetentionService();

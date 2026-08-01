import { BaseService } from '../../lib/base-service.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  RETENTION_TIER_WINDOWS,
  type RegisterCategoryInput,
  type TagRecordInput,
  type RetentionCategoryDto,
  type RetentionLogDto,
} from './types.js';

// SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN). PR 2 of 5: RetentionService
// core interfaces only -- IF-RETENTION-RegisterCategory, IF-RETENTION-TagRecord,
// and their internal validation/registration logic. No route, controller,
// scheduler, eligibility API, or audit API is introduced by this PR (those
// are PR 3/4/5's scope).
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
}

export const retentionService = new RetentionService();

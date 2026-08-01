// SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN). RetentionService interfaces
// across PR 2/4/5 -- PR 2: IF-RETENTION-RegisterCategory, IF-RETENTION-
// TagRecord (REQ-RETENTION-013..015 / RULE-RETENTION-01..03/07). PR 4:
// IF-RETENTION-GetDeletionAuditLog (RULE-RETENTION-06, FIND-SEC-003). PR 5:
// IF-RETENTION-CheckEligibility, plus route wiring for both PR 4 and PR 5's
// query interfaces.

import { z } from 'zod';
import { RetentionTier } from '@prisma/client';

// RULE-RETENTION-01: exactly the three CRR §25-confirmed tiers, closed set.
export const RETENTION_TIERS = [
  RetentionTier.TIER_1,
  RetentionTier.TIER_2,
  RetentionTier.TIER_3,
] as const;

// REQ-RETENTION-013's own acceptance criterion requires the schema to encode
// each tier's window ("queryable as a distinct, stable tier identifier with
// its window encoded") -- schema.prisma's own comment (RetentionTier) frames
// this as a service-layer choice, not a schema column; this map is that
// choice's single source of truth. Values are calendar-unit windows, not
// millisecond counts, since "6 months"/"5 years"/"6 years" are calendar
// concepts (leap years, variable month lengths) -- computed via Date's own
// setMonth()/setFullYear() at call time, not a fixed-duration subtraction.
export const RETENTION_TIER_WINDOWS: Record<
  RetentionTier,
  { unit: 'months' | 'years'; amount: number }
> = {
  [RetentionTier.TIER_1]: { unit: 'months', amount: 6 },
  [RetentionTier.TIER_2]: { unit: 'years', amount: 5 },
  [RetentionTier.TIER_3]: { unit: 'years', amount: 6 },
};

// RULE-RETENTION-03: a tagged record's deletion-due date is its tagged_at
// plus its tier's window -- the forward-looking mirror of sweep-job.ts's
// computeCutoff() (which computes the cutoff backward from "now" to find
// what's already eligible). Both live off RETENTION_TIER_WINDOWS as the
// single source of truth and use the same calendar-unit arithmetic
// (setMonth()/setFullYear(), not a fixed-duration add) so the two
// computations can never silently diverge. Exported so both service.ts
// (IF-RETENTION-CheckEligibility) and sweep-job.ts could share it, though
// the sweep computes a cutoff directly rather than a per-row due date.
export function computeDueDate(tier: RetentionTier, taggedAt: Date): Date {
  const window = RETENTION_TIER_WINDOWS[tier];
  const dueDate = new Date(taggedAt);
  if (window.unit === 'months') {
    dueDate.setMonth(dueDate.getMonth() + window.amount);
  } else {
    dueDate.setFullYear(dueDate.getFullYear() + window.amount);
  }
  return dueDate;
}

// RULE-RETENTION-02/REQ-RETENTION-014: consuming-module + category identifiers
// are module-scoped strings (e.g. "attendance", "shift_coordinate"), matching
// RetentionCategory's own module_id/category_id columns and the spec's own
// IF-RETENTION-RegisterCategory example ("attendance.shift_coordinate").
export const RegisterCategorySchema = z.object({
  module_id: z.string().min(1),
  category_id: z.string().min(1),
  tier: z.nativeEnum(RetentionTier),
});
export type RegisterCategoryInput = z.infer<typeof RegisterCategorySchema>;

// IF-RETENTION-TagRecord: category is identified by the same (module_id,
// category_id) pair used at registration, not RetentionCategory's own
// internal id -- the calling module never needs to know or store this
// module's primary keys, only the identifiers it chose itself.
export const TagRecordSchema = z.object({
  module_id: z.string().min(1),
  category_id: z.string().min(1),
  record_ref: z.string().min(1),
  tagged_at: z.coerce.date(),
});
export type TagRecordInput = z.infer<typeof TagRecordSchema>;

export interface RetentionCategoryDto {
  id: string;
  module_id: string;
  category_id: string;
  tier: RetentionTier;
  window: { unit: 'months' | 'years'; amount: number };
}

export interface RetentionLogDto {
  id: string;
  category_id: string;
  record_ref: string;
  tagged_at: string;
  deleted_at: string | null;
}

// IF-RETENTION-GetDeletionAuditLog: date range MUST be bounded/paginated
// per the spec's own explicit guardrail -- no unbounded full-history scan,
// mirroring docs/03-modules/consent/MODULE_SPEC.md's identical
// IF-CONSENT-GetAuditHistory treatment (GetAuditHistoryQuerySchema in
// consent/types.ts). module_id and category_id are each independently
// optional -- the spec names only "optional category filter" and does not
// require pairing them. A category_id-only query is permitted but spans
// every module's namespace (category_id alone is not globally unique,
// per IF-RETENTION-RegisterCategory's own "attendance.shift_coordinate"
// framing) -- callers who need an unambiguous scope should supply both.
export const GetDeletionAuditLogQuerySchema = z.object({
  module_id: z.string().min(1).optional(),
  category_id: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
export type GetDeletionAuditLogQuery = z.infer<typeof GetDeletionAuditLogQuerySchema>;

// FIND-SEC-003: fixed field allow-list -- category identifier, tier, and
// deletion timestamp only, never the deleted record's own data (id/
// module_id are structural identifiers needed to disambiguate rows, not
// part of that personal-data-exclusion guarantee). This type is
// structurally incapable of carrying a record_ref or any other field,
// mirroring RetentionAuditEntry's own schema shape (PR 1) and
// ConsentRecordDto's equivalent restriction.
export interface RetentionAuditEntryDto {
  id: string;
  module_id: string;
  category_id: string;
  tier: RetentionTier;
  deleted_at: string;
}

// IF-RETENTION-CheckEligibility: "category identifier and/or record
// reference" per the spec's own Interfaces and Contracts table. Unlike
// GetDeletionAuditLog's broader browsing use case (module_id/category_id
// independently optional, PR 4), this interface answers "is THIS specific
// record eligible" -- record_ref alone is meaningless without knowing
// which category it was tagged under (an opaque cross-module string could
// collide across categories), so module_id+category_id are both required
// together here, and record_ref is optional (querying a category's own
// eligibility posture in general, vs. a specific tagged record).
export const CheckEligibilityQuerySchema = z.object({
  module_id: z.string().min(1),
  category_id: z.string().min(1),
  record_ref: z.string().min(1).optional(),
});
export type CheckEligibilityQuery = z.infer<typeof CheckEligibilityQuerySchema>;

// Result shape: eligible/not-eligible/not-found (never a thrown error for
// "no such record" -- mirrors ConsentStatus's discriminated-result pattern
// for the identical "nothing decided yet" case, and this interface's own
// spec row: "Not found (no history) -- returns empty, not an error").
// due_date is always the computed value regardless of current eligibility
// (RULE-RETENTION-03: eligibility is computed, not manually flagged), so a
// caller can display "eligible" or "becomes eligible on <due_date>" from
// the same response shape.
export type EligibilityResult =
  | { status: 'not_found' }
  | { status: 'eligible' | 'not_eligible'; due_date: string };

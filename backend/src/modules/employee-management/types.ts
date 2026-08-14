import { z } from 'zod';
import { DeactivationReason, EmploymentType, SkillTag } from '@prisma/client';
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from './constants.js';

// IF-EMP-CreateEmployee / v0 (REQ-EMP-001, REQ-EMP-003, REQ-EMP-011).
// employment_type is REQUIRED (2026-08-13 contract feature): the creating
// actor (the applicant's direct superior in the hierarchy) must declare
// full-time or part-time for the person they are onboarding -- it drives
// the marking expected on the downloaded default contract PDF and is
// copied onto the auto-generated Contract row (hr/service.ts
// generateDefaultContract()).
export const CreateEmployeeSchema = z.object({
  user_id: z.string().min(1),
  employee_id: z.string().min(1).max(100),
  job_title: z.string().min(1).max(200),
  start_date: z.coerce.date(),
  employment_type: z.nativeEnum(EmploymentType, {
    required_error: 'employment_type is required (FULL_TIME or PART_TIME)',
  }),
  skills: z.array(z.nativeEnum(SkillTag)).optional(),
  personal_data: z.record(z.unknown()).optional(),
  work_permit_required: z.boolean().optional(),
  target_hotel_group_id: z.string().optional(),
  target_primary_hotel_id: z.string().optional(),
});

export type CreateEmployeeRequest = z.infer<typeof CreateEmployeeSchema>;

// IF-EMP-UpdateEmployee / v0
export const UpdateEmployeeSchema = z.object({
  job_title: z.string().min(1).max(200).optional(),
  employment_type: z.nativeEnum(EmploymentType).optional(),
  skills: z.array(z.nativeEnum(SkillTag)).optional(),
});

export type UpdateEmployeeRequest = z.infer<typeof UpdateEmployeeSchema>;


// REQ-EMP-006 / RULE-EMP-10: bulk CSV import, one row per employee, each row
// routed through the same path as manual creation.
export const BulkImportSchema = z.object({
  rows: z.array(CreateEmployeeSchema).min(1),
});

export type BulkImportRequest = z.infer<typeof BulkImportSchema>;

// IF-EMP-GetProfileHistory / v0 (REQ-EMP-004). Bounds are PROVISIONAL
// (OD-EMP-16 / PERF-EMP-002) — see constants.ts.
export const ProfileHistoryQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  months: z.coerce.number().min(1).optional(),
  from_date: z.coerce.date().optional(),
  to_date: z.coerce.date().optional(),
});

export type ProfileHistoryQuery = z.infer<typeof ProfileHistoryQuerySchema>;

// IF-EMP-SetBlocklist / v0 (REQ-EMP-005 / RULE-EMP-07): reason is required.
export const SetBlocklistSchema = z.object({
  employee_id: z.string().min(1),
  reason: z.string().min(1, 'reason is required'),
});

export type SetBlocklistRequest = z.infer<typeof SetBlocklistSchema>;

export const BlocklistQuerySchema = z.object({
  employee_id: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type BlocklistQuery = z.infer<typeof BlocklistQuerySchema>;

// IF-EMP-GetSpecialCategory / v0 (REQ-EMP-007 / RULE-EMP-09): restricted field set.
export const SpecialCategoryParamsSchema = z.object({
  employee_id: z.string().min(1),
  field: z.enum(['konfession', 'disability_status']),
});

export type SpecialCategoryField = z.infer<typeof SpecialCategoryParamsSchema>['field'];

// IF-EMP-GetOrgChart / v0 (REQ-EMP-013).
export const OrgChartParamsSchema = z.object({
  hotel_group_id: z.string().min(1),
});

// IF-EMP-GetByUserId / v0: resolves a User's EmploymentRecord (or absence of
// one) by the account id, the join key every other module already uses
// (roster-scope.ts, scope.ts, hr/service.ts, etc.) — distinct from this
// module's own `employee_id`-keyed routes.
export const ByUserParamsSchema = z.object({
  user_id: z.string().min(1),
});

// ── Lifecycle actions (REQ-EMP-002 rework, 2026-08-06) ──────────────────────
//
// Replaces the single IF-EMP-LifecycleSignal endpoint's
// `{signal, hotel_group_id}` body with one schema per action. The generic
// shape could not survive the rework: deactivate now requires a
// DeactivationReason enum and delete requires a free-text deleted_reason,
// neither of which applies to any other signal — expressing that in one
// schema means conditionally-required fields keyed off `signal`, i.e. the
// validation Zod would otherwise do for free, hand-rolled. One schema per
// action keeps each endpoint's contract independently readable, the same way
// SetBlocklistSchema states its own required-reason rule locally.

// PENDING -> ACTIVE. hotel_group_id is an explicit fallback only (ADR-023 §4
// provisional resolution order) — see
// EmployeeManagementService.resolveApprovalGroupId.
export const ApproveEmployeeSchema = z.object({
  hotel_group_id: z.string().optional(),
});

export type ApproveEmployeeRequest = z.infer<typeof ApproveEmployeeSchema>;

// PENDING -> REJECTED. Reason is optional here, unlike deactivate/delete
// below: a rejection ends an application that never became employment, so
// there is no employment record state that depends on the reason being
// present (contrast deactivation_reason/deleted_reason, both persisted
// columns the rework requires on their transitions).
export const RejectEmployeeSchema = z.object({
  reason: z.string().max(1000).optional(),
});

export type RejectEmployeeRequest = z.infer<typeof RejectEmployeeSchema>;

// ACTIVE -> DEACTIVATED (temporary pause). deactivation_reason is required
// and constrained to the DeactivationReason enum (schema.prisma).
export const DeactivateEmployeeSchema = z.object({
  deactivation_reason: z.nativeEnum(DeactivationReason, {
    required_error: 'deactivation_reason is required',
  }),
});

export type DeactivateEmployeeRequest = z.infer<typeof DeactivateEmployeeSchema>;

// ACTIVE/DEACTIVATED/REJECTED -> DELETED (left the company). Free text, not
// an enum — "why someone left" doesn't reduce to a fixed small set the way a
// pause reason does (schema.prisma DeactivationReason note). Required, same
// non-blank rule as SetBlocklistSchema.
export const DeleteEmployeeSchema = z.object({
  deleted_reason: z.string().trim().min(1, 'deleted_reason is required').max(1000),
});

export type DeleteEmployeeRequest = z.infer<typeof DeleteEmployeeSchema>;

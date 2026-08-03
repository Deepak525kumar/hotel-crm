import { z } from 'zod';
import { SkillTag } from '@prisma/client';
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from './constants.js';

// IF-EMP-CreateEmployee / v0 (REQ-EMP-001, REQ-EMP-003, REQ-EMP-011).
export const CreateEmployeeSchema = z.object({
  user_id: z.string().min(1),
  employee_id: z.string().min(1).max(100),
  job_title: z.string().min(1).max(200),
  start_date: z.coerce.date(),
  skills: z.array(z.nativeEnum(SkillTag)).optional(),
  personal_data: z.record(z.unknown()).optional(),
});

export type CreateEmployeeRequest = z.infer<typeof CreateEmployeeSchema>;

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

// IF-EMP-GetBlocklist / v0.
export const BlocklistQuerySchema = z.object({
  employee_id: z.string().optional(),
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

// IF-EMP-LifecycleSignal / v0 (internal, Onboarding-driven).
export const LifecycleSignalSchema = z.object({
  signal: z.enum(['submitted_for_review', 'approved', 'rejected']),
  // Explicit fallback only (ADR-023 §4 provisional resolution order) — see
  // EmployeeManagementService.resolveApprovalGroupId.
  hotel_group_id: z.string().optional(),
});

export type LifecycleSignalRequest = z.infer<typeof LifecycleSignalSchema>;
export type LifecycleSignal = LifecycleSignalRequest['signal'];

import { z } from 'zod';
import { SkillTag } from '@prisma/client';

// Schema is the frozen authority for enums (PRISMA_SCHEMA_V2_FREEZE). The
// API_SPEC_V1_PATCH_V2 OPEN/CLOSED enum was written before the freeze and is
// superseded — see the audit. DTO field names follow the spec where they are
// pure presentation; enums follow the schema.
const WorkRequestStatusEnum = z.enum([
  'DRAFT',
  'OPEN',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELLED',
  'EXPIRED',
]);

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM (24h)');

export const CreateWorkRequestSchema = z.object({
  hotel_id: z.string().min(1),
  position: z.string().min(1),
  workers_needed: z.number().int().positive().max(1000).default(1),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  shift_start_time: timeString,
  shift_end_time: timeString,
  hourly_rate: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  description: z.string().optional(),
  requirements: z.string().optional(),
  // A request may be created as a DRAFT or published straight to OPEN.
  status: z.enum(['DRAFT', 'OPEN']).default('DRAFT'),
  expires_at: z.string().datetime().optional(),
});

export type CreateWorkRequestInput = z.infer<typeof CreateWorkRequestSchema>;

export const UpdateWorkRequestSchema = z
  .object({
    position: z.string().min(1).optional(),
    workers_needed: z.number().int().positive().max(1000).optional(),
    shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    shift_start_time: timeString.optional(),
    shift_end_time: timeString.optional(),
    hourly_rate: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
    description: z.string().optional(),
    requirements: z.string().optional(),
    expires_at: z.string().datetime().optional(),
    // Status transitions are guarded in the service.
    status: WorkRequestStatusEnum.optional(),
    cancellation_reason: z.string().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

export type UpdateWorkRequestInput = z.infer<typeof UpdateWorkRequestSchema>;

export const ListWorkRequestsQuerySchema = z.object({
  hotel_id: z.string().optional(),
  status: z.union([WorkRequestStatusEnum, z.array(WorkRequestStatusEnum)]).optional(),
  position: z.string().optional(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Filters to broadcast rows only (has skill_slots) or marketplace rows
  // only (no skill_slots). Reuses the same `skill_slots: { some: {} }` /
  // `{ none: {} }` discriminator closeExpiredBroadcasts() already uses
  // server-side (service.ts). Explicit z.enum(["true","false"]) rather than
  // z.coerce.boolean(): the latter maps ANY non-empty string, including the
  // literal "false", to true (Boolean("false") === true) — an earlier
  // attempt at this filter used z.coerce.boolean() and was rejected in
  // review for exactly that reason.
  is_broadcast: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
});

export type ListWorkRequestsQuery = z.infer<typeof ListWorkRequestsQuerySchema>;

// Epic 9 PR 9.7 (TREQ-002/TREQ-003/TREQ-010, MIG-GAP-04/05): manager raises a
// standalone broadcast JobRequest specifying skill(s) and headcount per
// skill (e.g. "2 Cleaners + 1 Waiter" is two entries in `skills`), per
// CONFIRMED_REQUIREMENTS_REGISTER.md §13. Distinct from
// CreateWorkRequestSchema (the pre-existing marketplace publish/apply
// shape, untouched by this PR) -- a broadcast has no free-text `position`
// and no single `workers_needed`.
export const RaiseBroadcastSchema = z.object({
  hotel_id: z.string().min(1),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  shift_start_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM (24h)'),
  shift_end_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM (24h)'),
  hourly_rate: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  description: z.string().optional(),
  // `skill: null` (2026-08-26) means "no specific skill required" -- the
  // line is open to every roster-eligible, free worker at the hotel
  // regardless of which (if any) skill tags they hold. Explicit `.nullable()`
  // rather than `.optional()`: the caller must say "no skill" on purpose, not
  // merely omit the field.
  skills: z
    .array(
      z.object({
        skill: z.nativeEnum(SkillTag).nullable(),
        headcount: z.number().int().positive(),
      })
    )
    .min(1, 'At least one skill x headcount line is required'),
});

export type RaiseBroadcastInput = z.infer<typeof RaiseBroadcastSchema>;

export interface JobRequestSkillSlotDto {
  id: string;
  /** `null` means "no specific skill required" — see RaiseBroadcastSchema. */
  skill: SkillTag | null;
  headcount: number;
  confirmed_count: number;
}

// Read-only: eligibility for one skill slot on a broadcast (skill match ∧
// free that day, TREQ-003/TRULE-006). Populated only for a broadcast
// JobRequest (one that has skill_slots); this PR computes and returns this
// set but does not notify anyone (PR 9.8) or let anyone accept (PR 9.9).
//
// Role-scoped correction (post-Epic-9 discovery, not part of any closed
// PR): the original shape returned eligible_worker_ids — every eligible
// worker's user id — to ANY authenticated caller, since this route has no
// requireRole gate (a worker calling it needs a response, so admin/manager
// -only was never viable). That leaked the full roster's user ids to any
// worker who called the route directly. eligible_worker_ids is removed:
// eligible_count (a headcount, safe for anyone, matches what both existing
// UI consumers actually rendered — a count, never the raw list) replaces
// it for every caller; eligible (this caller's own inclusion) is added for
// a worker/checker caller only, computed server-side from the same set
// this DTO used to expose wholesale.
export interface SkillSlotEligibilityDto {
  /** `null` means "no specific skill required" — see RaiseBroadcastSchema. */
  skill: SkillTag | null;
  headcount: number;
  confirmed_count: number;
  eligible_count: number;
  /** Present only when the caller's role is worker/checker — their own eligibility for this slot. */
  eligible?: boolean;
}

export interface BroadcastEligibilityDto {
  job_request_id: string;
  hotel_id: string;
  shift_date: string; // YYYY-MM-DD
  slots: SkillSlotEligibilityDto[];
}

// Epic 9 PR 9.9 (TREQ-004/TREQ-005, MIG-GAP-06): a worker accepts one skill
// slot on a broadcast JobRequest. `skill` disambiguates which slot on a
// multi-skill broadcast the worker is claiming (e.g. a worker holding both
// CLEANER and WAITER must say which opening they're accepting). `null`
// (2026-08-26) claims the "no specific skill required" slot, if the
// broadcast has one — see RaiseBroadcastSchema.
export const AcceptBroadcastSchema = z.object({
  skill: z.nativeEnum(SkillTag).nullable(),
});

export type AcceptBroadcastInput = z.infer<typeof AcceptBroadcastSchema>;

// Discriminated response: a successful claim returns the created assignment;
// a lost race (slot already filled by the time this claim ran) returns the
// "requirement fulfilled" response (TREQ-005) instead of an error.
export interface AcceptBroadcastAssignmentDto {
  status: 'accepted';
  assignment_id: string;
  job_request_id: string;
  skill: SkillTag | null;
}

export interface AcceptBroadcastFulfilledDto {
  status: 'requirement_fulfilled';
  job_request_id: string;
  skill: SkillTag | null;
}

export type AcceptBroadcastResultDto = AcceptBroadcastAssignmentDto | AcceptBroadcastFulfilledDto;

export interface WorkRequestDto {
  id: string;
  hotel_id: string;
  created_by_id: string;
  position: string;
  workers_needed: number;
  workers_confirmed: number;
  shift_date: string; // YYYY-MM-DD
  shift_start_time: string;
  shift_end_time: string;
  hourly_rate: number | null;
  currency: string;
  description: string | null;
  requirements: string | null;
  status: string;
  published_at: string | null;
  expires_at: string | null;
  filled_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  my_application?: { id: string; status: string; created_at: string } | null;
  // Epic 9 PR 9.7: present (non-empty) only for a broadcast JobRequest
  // raised via raiseBroadcast(); absent/undefined for a marketplace
  // publish/apply row (this PR does not backfill or infer skill_slots for
  // pre-existing rows).
  skill_slots?: JobRequestSkillSlotDto[];
}

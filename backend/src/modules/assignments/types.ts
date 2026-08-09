import { z } from 'zod';
import { AssignmentStatus } from '@prisma/client';

export const UpdateAssignmentSchema = z
  .object({
    status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    cancellation_reason: z.string().max(500).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

// Job-dispatch lifecycle feature (2026-08-05): atomic reassign. Replaces the
// old worker on a CONFIRMED/IN_PROGRESS assignment with a new one, in one
// transaction (old -> REASSIGNED, new -> CONFIRMED, chained via
// previous_assignment_id) instead of two independent cancel-then-recreate
// calls that could leave the shift unstaffed between them if the second
// call failed. Same hotel/day as the original assignment -- reassigning to
// a different hotel or day is a new placement, not this endpoint.
export const ReassignAssignmentSchema = z.object({
  worker_id: z.string().min(1),
});

export const ListAssignmentsQuerySchema = z.object({
  hotel_id: z.string().optional(),
  work_request_id: z.string().optional(),
  worker_id: z.string().optional(),
  status: z.nativeEnum(AssignmentStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

// Epic 9 PR 9.5 (TREQ-001/TRULE-001, MIG-GAP-03): manager places a worker on
// the calendar for a specific day — direct assignment, no accept/decline.
export const CreateCalendarEntrySchema = z.object({
  worker_id: z.string().min(1),
  hotel_id: z.string().min(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
});

// Calendar grid view: drag/drop scheduling. Day-only move — the hotel and
// worker on a CalendarEntry never change via this endpoint (product
// decision, 2026-08-05); moving to a different hotel means cancelling and
// re-placing, not this endpoint.
export const MoveCalendarEntrySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
});

export const ListCalendarEntriesQuerySchema = z.object({
  worker_id: z.string().optional(),
  hotel_id: z.string().optional(),
  // Calendar grid view: an optional bounded day range, so a week/month view
  // doesn't have to page through every placement ever made. Both or neither —
  // a lone `from`/`to` would silently produce an unbounded-on-one-side query.
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD').optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
}).refine((v) => (v.from == null) === (v.to == null), {
  message: 'from and to must be provided together',
});

// ADR-028 (OQ-ANALYTICS-03): manager-entered "rooms completed" count for a
// worker's full-day WorkerAssignment. Not a per-task/per-room record.
export const LogRoomsCompletedSchema = z.object({
  rooms_completed: z.number().int().min(0),
  notes: z.string().max(1000).optional(),
});

export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>;
export type ReassignAssignmentInput = z.infer<typeof ReassignAssignmentSchema>;
export type ListAssignmentsQuery = z.infer<typeof ListAssignmentsQuerySchema>;
export type LogRoomsCompletedInput = z.infer<typeof LogRoomsCompletedSchema>;
export type CreateCalendarEntryInput = z.infer<typeof CreateCalendarEntrySchema>;
export type MoveCalendarEntryInput = z.infer<typeof MoveCalendarEntrySchema>;
export type ListCalendarEntriesQuery = z.infer<typeof ListCalendarEntriesQuerySchema>;

export interface RoomsCompletedEntryDto {
  id: string;
  assignment_id: string;
  hotel_id: string;
  worker_id: string;
  entered_by_id: string;
  // 2026-08-10 (review follow-up, PR #395 item A): the display name of
  // entered_by_id at read time, so the calendar UI can show "logged by
  // Jane Doe" without a second round-trip. Optional/nullable rather than
  // always-present: the entering user may since have been deleted (User FK
  // has no cascade/restrict tying RoomsCompletedEntry's lifetime to the
  // entering user's), in which case entered_by_id is still a valid
  // historical reference but there is no name to resolve.
  entered_by_name?: string | null;
  rooms_completed: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssignmentDto {
  id: string;
  // Epic 9 PR 9.5 (MIG-GAP-03): nullable to match the relaxed
  // WorkerAssignment.work_request_id column — calendar-placed assignments
  // (placeOnCalendar()) and, later, broadcast-accept rows (PR 9.9) leave this
  // null (job_request_id is the FK populated for those creation paths).
  work_request_id: string | null;
  worker_id: string;
  hotel_id: string;
  assigned_by_id: string;
  status: AssignmentStatus;
  confirmed_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  updated_at: string;
  // 2026-08-09: the RoomsCompletedEntry attached to this assignment, if one
  // has been logged (ADR-028's manager-entered post-shift count). Null until
  // POST /:id/rooms-completed is called — never fabricated as 0, since "not
  // yet entered" and "zero rooms" are different facts. Visibility follows
  // getById()/list()'s EXISTING ownership/scope gate (worker sees own,
  // manager/RM sees in-scope, admin sees all) -- no separate check needed,
  // since this is read-only exposure of data the caller could already see.
  rooms_completed: RoomsCompletedEntryDto | null;
}

// Epic 9 PR 9.5 (TREQ-001/TRULE-001, MIG-GAP-03).
export interface CalendarEntryDto {
  id: string;
  assignment_id: string;
  worker_id: string;
  hotel_id: string;
  day: string; // YYYY-MM-DD
  placed_by_id: string;
  created_at: string;
  updated_at: string;
}

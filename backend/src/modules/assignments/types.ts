import { z } from 'zod';
import { AssignmentStatus } from '@prisma/client';

export const UpdateAssignmentSchema = z
  .object({
    status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    cancellation_reason: z.string().max(500).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

export const ListAssignmentsQuerySchema = z.object({
  hotel_id: z.string().optional(),
  work_request_id: z.string().optional(),
  worker_id: z.string().optional(),
  status: z.nativeEnum(AssignmentStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

// ADR-028 (OQ-ANALYTICS-03): manager-entered "rooms completed" count for a
// worker's full-day WorkerAssignment. Not a per-task/per-room record.
export const LogRoomsCompletedSchema = z.object({
  rooms_completed: z.number().int().min(0),
  notes: z.string().max(1000).optional(),
});

export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>;
export type ListAssignmentsQuery = z.infer<typeof ListAssignmentsQuerySchema>;
export type LogRoomsCompletedInput = z.infer<typeof LogRoomsCompletedSchema>;

export interface RoomsCompletedEntryDto {
  id: string;
  assignment_id: string;
  hotel_id: string;
  worker_id: string;
  entered_by_id: string;
  rooms_completed: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssignmentDto {
  id: string;
  work_request_id: string;
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
}

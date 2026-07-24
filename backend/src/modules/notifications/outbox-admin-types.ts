import { z } from 'zod';

// Epic 7 PR 7.6 (ADR-029 §9): operator dead-letter triage. Pagination bounds
// mirror ListAttendanceQuerySchema (attendance/types.ts) so the operator
// surface behaves like every other list endpoint in the API.
export const ListDeadLettersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListDeadLettersQuery = z.infer<typeof ListDeadLettersQuerySchema>;

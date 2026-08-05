import { z } from 'zod';

export const MarkAbsenceSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
  kind: z.enum(['SICK', 'VACATION']),
});

export type MarkAbsenceInput = z.infer<typeof MarkAbsenceSchema>;

// New (calendar grid view): manager/regional_manager/admin read of absences
// across their scoped team, for a bounded date range -- distinct from
// /my-absences (self-only, no range). View-only by design: REQ-CAL-T03's
// "no cap, no approval" self-service model is unchanged; this adds no write
// path for marking a worker's absence on their behalf.
export const ListAbsencesQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
  worker_id: z.string().min(1).optional(),
});

export type ListAbsencesQuery = z.infer<typeof ListAbsencesQuerySchema>;

export interface DailyOperation {
  id: string;
  date: string;
  room_count: number;
  checkout_count: number;
  stay_over_count: number;
  notes?: string;
}

// SPEC-CALENDAR-001 REQ-CAL-T08 (narrow ADR-021 slice).
export interface CalendarAbsenceDto {
  id: string;
  worker_id: string;
  day: string;
  kind: 'SICK' | 'VACATION';
  created_at: string;
  updated_at: string;
}

// SPEC-CALENDAR-001 REQ-CAL-T06/RULE-CAL-08, IF-CAL-GetAvailability/v0.
// Today-only; independent of any viewed calendar date -- there is no `day`
// field to request or return.
export interface AvailabilityDto {
  worker_id: string;
  available: boolean;
}

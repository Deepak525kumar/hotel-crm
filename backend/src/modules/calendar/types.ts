import { z } from 'zod';

export const MarkAbsenceSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
  kind: z.enum(['SICK', 'VACATION']),
});

export type MarkAbsenceInput = z.infer<typeof MarkAbsenceSchema>;

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

import { z } from 'zod';

// Reason (2026-08-08 feature): mandatory for VACATION, optional for SICK.
// See schema.prisma's CalendarAbsence.reason comment for why SICK is
// deliberately NOT forced -- avoids incentivizing health-detail disclosure
// (GDPR special-category data) on what this model has always kept as a
// plain flag (CRR §27 §353).
export const MarkAbsenceSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
    kind: z.enum(['SICK', 'VACATION']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((d) => d.kind !== 'VACATION' || (d.reason && d.reason.length > 0), {
    message: 'reason is required for a VACATION absence',
    path: ['reason'],
  });

export type MarkAbsenceInput = z.infer<typeof MarkAbsenceSchema>;

// Manager/RM/admin marks or corrects an absence on a worker's behalf
// (2026-08-08 feature) -- same field shape as MarkAbsenceSchema plus the
// explicit target worker_id (never trusted from a self-scoped caller).
export const MarkAbsenceForWorkerSchema = MarkAbsenceSchema.and(
  z.object({ worker_id: z.string().min(1) })
);

export type MarkAbsenceForWorkerInput = z.infer<typeof MarkAbsenceForWorkerSchema>;

// Drag-to-move (2026-08-08 feature): day-only move, mirrors
// assignments/types.ts's MoveCalendarEntrySchema exactly. Worker/kind/reason
// are unchanged by a move -- only the day.
export const MoveCalendarAbsenceSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
});

export type MoveCalendarAbsenceInput = z.infer<typeof MoveCalendarAbsenceSchema>;

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
  reason: string | null;
  // Who performed the mark/move -- the worker themself (self-service) or a
  // manager/RM/admin acting on their behalf (2026-08-08 feature). Null for
  // pre-migration rows with no recorded actor.
  marked_by_id: string | null;
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

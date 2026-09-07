import { z } from 'zod';
import { AttendanceStatus } from '@prisma/client';

// GD-14: latitude/longitude are optional -- Attendance's geofence
// verification only runs when a caller supplies both (mobile's
// "Verify Location" wiring is a later slice; omitting them preserves prior
// check-in behavior exactly, per TREQ-ATT-GEO-001).
export const CheckInSchema = z.object({
  assignment_id: z.string(),
  notes: z.string().max(1000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).refine((d) => (d.latitude === undefined) === (d.longitude === undefined), {
  message: 'latitude and longitude must both be provided together',
});

// Checkout geofence fix (2026-08-08): mirrors CheckInSchema's optional
// latitude/longitude pair -- required together, not individually, so a
// caller cannot supply one without the other. Same "both or neither" refine.
export const UpdateAttendanceSchema = z
  .object({
    check_out_at: z.string().datetime().optional(),
    notes: z.string().max(1000).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    // Manager-only verification fields
    status: z
      .enum(['PRESENT', 'ABSENT', 'LATE', 'PARTIAL', 'EXCUSED'])
      .optional(),
    // 2026-08-13 fix (E2E integration audit): every other timesheet-error
    // field a manager might need to correct was here (check_out_at,
    // minutes_late, minutes_worked, status) except check_in_at itself -- a
    // worker whose phone died or who forgot to check in had no field a
    // manager could set to fix it; the record permanently showed no check-in
    // at all. Manager-only (see service.ts's isWorker guard), same tier as
    // is_verified/minutes_worked below.
    check_in_at: z.string().datetime().optional(),
    minutes_late: z.number().int().min(0).optional(),
    minutes_worked: z.number().int().min(0).optional(),
    is_verified: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' })
  .refine((d) => (d.latitude === undefined) === (d.longitude === undefined), {
    message: 'latitude and longitude must both be provided together',
  });

export const ListAttendanceQuerySchema = z.object({
  // Optional date range, added 2026-09-08 for reporting. Additive and
  // backward-compatible: absent means "no date filter", which is exactly the
  // behaviour every existing caller already gets. Both or neither -- a
  // half-open range reads as a typo more often than an intention.
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hotel_id: z.string().optional(),
  worker_id: z.string().optional(),
  assignment_id: z.string().optional(),
  status: z.nativeEnum(AttendanceStatus).optional(),
  is_verified: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
}).refine((v) => (v.from == null) === (v.to == null), {
  message: 'from and to must be provided together',
});

export type CheckInInput = z.infer<typeof CheckInSchema>;
export type UpdateAttendanceInput = z.infer<typeof UpdateAttendanceSchema>;
export type ListAttendanceQuery = z.infer<typeof ListAttendanceQuerySchema>;

export interface AttendanceDto {
  id: string;
  assignment_id: string;
  worker_id: string;
  hotel_id: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  expected_start: string | null;
  expected_end: string | null;
  minutes_late: number | null;
  minutes_worked: number | null;
  notes: string | null;
  is_verified: boolean;
  verified_by_id: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Who and where, resolved for the read paths (list/getById).
   *
   * Without these the DTO carried only ids, and the checker app rendered
   * `Worker ···{worker_id.slice(-6)}` — literally the last six characters of a
   * cuid — with no hotel shown at all. A checker verifying attendance could not
   * tell whose attendance it was.
   *
   * Nested here rather than expecting the client to call /users/:id and
   * /crm/hotels/:id: both are scoped for a checker (the hotel endpoint 403s
   * outright), so the names were unreachable. The existing scope gate on
   * list()/getById() already decides which attendance rows the caller sees, so
   * this exposes no row they could not already read — only the names for it.
   */
  worker: AttendancePersonDto | null;
  hotel: AttendanceHotelDto | null;
  /** The name of whoever verified it, when it has been verified. */
  verified_by_name: string | null;
}

/** Just enough to identify a person on screen. No contact details or role. */
export interface AttendancePersonDto {
  id: string;
  first_name: string;
  last_name: string;
}

/** Just enough to identify the site. No commercial or managerial fields. */
export interface AttendanceHotelDto {
  id: string;
  name: string;
  city: string;
}

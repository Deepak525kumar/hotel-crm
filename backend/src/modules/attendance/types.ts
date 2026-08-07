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
    minutes_late: z.number().int().min(0).optional(),
    minutes_worked: z.number().int().min(0).optional(),
    is_verified: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' })
  .refine((d) => (d.latitude === undefined) === (d.longitude === undefined), {
    message: 'latitude and longitude must both be provided together',
  });

export const ListAttendanceQuerySchema = z.object({
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
}

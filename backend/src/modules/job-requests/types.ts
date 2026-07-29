import { z } from 'zod';

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
  status: WorkRequestStatusEnum.optional(),
  position: z.string().optional(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
});

export type ListWorkRequestsQuery = z.infer<typeof ListWorkRequestsQuerySchema>;

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
}

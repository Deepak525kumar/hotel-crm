import { z } from 'zod';
import { VerificationStatus } from '@prisma/client';

export const CreateVerificationSchema = z.object({
  assignment_id: z.string(),
  score: z.number().int().min(0).max(100),
  status: z.enum(['PASSED', 'FAILED', 'NEEDS_REWORK']).optional(),
  notes: z.string().max(2000).optional(),
  photo_urls: z.array(z.string().url()).max(20).optional(),
  rework_required: z.boolean().optional(),
  rework_notes: z.string().max(2000).optional(),
});

export const ListVerificationsQuerySchema = z.object({
  hotel_id: z.string().optional(),
  assignment_id: z.string().optional(),
  status: z.nativeEnum(VerificationStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateVerificationInput = z.infer<typeof CreateVerificationSchema>;
export type ListVerificationsQuery = z.infer<typeof ListVerificationsQuerySchema>;

export interface VerificationDto {
  id: string;
  assignment_id: string;
  hotel_id: string;
  verified_by_id: string;
  score: number;
  status: VerificationStatus;
  notes: string | null;
  photo_urls: string[];
  rework_required: boolean;
  rework_notes: string | null;
  rework_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

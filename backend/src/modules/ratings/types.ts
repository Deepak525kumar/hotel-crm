import { z } from 'zod';

export const CreateRatingSchema = z.object({
  assignment_id: z.string(),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
  criteria_scores: z
    .object({
      punctuality: z.number().int().min(1).max(5).optional(),
      quality: z.number().int().min(1).max(5).optional(),
      attitude: z.number().int().min(1).max(5).optional(),
    })
    .optional(),
});

export const ListRatingsQuerySchema = z.object({
  hotel_id: z.string().optional(),
  worker_id: z.string().optional(),
  assignment_id: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateRatingInput = z.infer<typeof CreateRatingSchema>;
export type ListRatingsQuery = z.infer<typeof ListRatingsQuerySchema>;

export interface RatingDto {
  id: string;
  assignment_id: string;
  hotel_id: string;
  worker_id: string;
  rated_by_id: string;
  score: number;
  comment: string | null;
  criteria_scores: Record<string, number> | null;
  created_at: string;
  updated_at: string;
}

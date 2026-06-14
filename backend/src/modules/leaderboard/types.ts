import { z } from 'zod';

export const LeaderboardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

export interface LeaderboardEntryDto {
  rank: number;
  worker_id: string;
  average_score: number;
  total_ratings: number;
  last_worked_at: string | null;
}

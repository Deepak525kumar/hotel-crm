import { z } from 'zod';

export const CreateQualityVerificationSchema = z.object({
  assignment_id: z.string().min(1),
  score: z.number().int().min(0).max(100),
  notes: z.string().optional(),
});

export interface CreateQualityVerificationRequest {
  assignment_id: string;
  score: number; // 0-100
  notes?: string;
}

export const CreateRatingSchema = z.object({
  assignment_id: z.string().min(1),
  worker_id: z.string().min(1),
  score: z.number().int().min(0).max(100),
  comment: z.string().optional(),
  criteria_scores: z.record(z.string(), z.number()).optional(),
});

export interface CreateRatingRequest {
  assignment_id: string;
  worker_id: string;
  score: number; // 0-100 (rescaled from 1-5 by ADR-026)
  comment?: string;
  criteria_scores?: Record<string, number>;
}

// ADR-035 (GD-11): leaderboard pagination is a MUST, default 25, max 100.
export const ListLeaderboardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListLeaderboardQuery = z.infer<typeof ListLeaderboardQuerySchema>;

// ADR-069 / CRR §14: a checker assigns rework to a specific worker. Photo
// evidence arrives as multipart, not in this body -- these are the non-file
// fields.
export const AssignReworkSchema = z.object({
  verification_id: z.string().min(1),
  notes: z.string().min(1, 'rework notes are required'),
});

export interface AssignReworkRequest {
  verification_id: string;
  notes: string;
}

// CRR §14: "Worker uploads a photo and clicks work done".
export const CompleteReworkSchema = z.object({
  assignment_id: z.string().min(1),
});

/** An uploaded image, already read into memory by multer. */
export interface UploadedPhoto {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

// CRR §15: the checker uploads a photo WITH the rating. Images only -- this is
// visual evidence of a room, not a document attachment.
export const ALLOWED_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
] as const;

// Per-photo cap; phone cameras routinely produce 3-8 MB JPEGs.
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// CRR §14/§15 do not bound the count. Implementation guard against one
// request pinning process memory, since multer buffers uploads in memory.
export const MAX_PHOTOS_PER_VERIFICATION = 6;

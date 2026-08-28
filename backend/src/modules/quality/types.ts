import {
  INSPECTION_CHECKLIST_ITEMS,
  type InspectionChecklistItem,
} from './inspection-checklist.js';
import { z } from 'zod';

export const CreateQualityVerificationSchema = z.object({
  assignment_id: z.string().min(1),
  // z.coerce, not z.number: this endpoint accepts multipart (CRR §15 puts a
  // photo WITH the rating), and every multipart field arrives as a STRING.
  // A plain z.number() rejected "50" with "Expected number, received string",
  // so the endpoint was broken for every real client -- including this repo's
  // own web form, which sends String(score). Unit tests missed it entirely
  // because they call the service directly with a number; only a real
  // multipart request reaches this.
  //
  // Coercion is safe for the JSON callers too: z.coerce.number() passes a
  // number through unchanged, and .int() still rejects "50.5" or "abc".
  score: z.coerce.number().int().min(0).max(100),
  notes: z.string().optional(),
});

export interface CreateQualityVerificationRequest {
  assignment_id: string;
  score: number; // 0-100
  notes?: string;
}

// 2026-08-24: this endpoint now accepts multipart (CRR §15's photo
// requirement, previously unenforceable here — Rating had no photo_urls
// column at all). Every multipart field arrives as a STRING, and a nested
// object like criteria_scores cannot survive multipart's flat field model at
// all, so the client JSON-stringifies it into one field. Mirrors
// CreateQualityVerificationSchema's z.coerce.number() fix for `score` (that
// endpoint hit the identical "multipart sends strings" defect first).
const criteriaScoresShape = z
  .record(z.enum(INSPECTION_CHECKLIST_ITEMS), z.coerce.number().int().min(0).max(100))
  .optional();

export const CreateRatingSchema = z.object({
  assignment_id: z.string().min(1),
  worker_id: z.string().min(1),
  score: z.coerce.number().int().min(0).max(100),
  comment: z.string().optional(),
  // TREQ-005: keys are the confirmed inspection checklist, not free-form.
  // This was `z.record(z.string(), z.number())`, which accepted any key at
  // all -- so the pre-pivot {punctuality, quality, attitude} triple validated
  // happily and nothing ever surfaced the divergence from CONFIRMED §15.
  // Values are 0-100 to match Rating.score's scale (ADR-026); the old schema
  // accepted any number, including negatives and 5000.
  criteria_scores: z.preprocess((val) => {
    // JSON callers already send a real object; multipart callers send the
    // same object JSON.stringify'd into one field. A malformed string is
    // passed through unchanged so the record/enum validation below produces
    // a normal field-level error instead of this preprocessor swallowing it.
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  }, criteriaScoresShape),
});

export interface CreateRatingRequest {
  assignment_id: string;
  worker_id: string;
  score: number; // 0-100 (rescaled from 1-5 by ADR-026)
  comment?: string;
  criteria_scores?: Partial<Record<InspectionChecklistItem, number>>;
}

// ADR-035 (GD-11): leaderboard pagination is a MUST, default 25, max 100.
export const ListLeaderboardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListLeaderboardQuery = z.infer<typeof ListLeaderboardQuerySchema>;

// The checker's own inspection history. Same page/per_page shape as the
// leaderboard above so the two read routes paginate identically; a lower
// per_page cap because each row carries two nested records rather than one
// scalar score.
export const ListOwnInspectionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListOwnInspectionsQuery = z.infer<typeof ListOwnInspectionsQuerySchema>;

/**
 * One inspection, one request (2026-08-29). Everything the checker captured,
 * plus the decision they made about it.
 *
 * Multipart, so every scalar arrives as a string: `score` needs
 * z.coerce.number() for the same reason CreateQualityVerificationSchema does
 * (a `z.number()` there rejected every photo-bearing rating while the
 * JSON-bodied unit tests passed), and `criteria_scores` arrives as a JSON
 * string rather than an object.
 *
 * `outcome` is the checker's decision and is NOT derived from `score` --
 * see QualityService.recordInspection and assignRework.
 */
export const RecordInspectionSchema = z.object({
  assignment_id: z.string().min(1),
  worker_id: z.string().min(1),
  score: z.coerce.number().int().min(0).max(100),
  comment: z.string().optional(),
  criteria_scores: z
    .string()
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'criteria_scores must be valid JSON' });
        return z.NEVER;
      }
    })
    .pipe(z.record(z.string(), z.coerce.number().int().min(0).max(100)))
    .optional(),
  outcome: z.enum(['complete', 'rework']),
  // Defaults to `comment` in the service: the checker app asks the question
  // once, and the answer is what the worker is sent.
  rework_notes: z.string().optional(),
});

export interface RecordInspectionRequest {
  assignment_id: string;
  worker_id: string;
  score: number;
  comment?: string;
  criteria_scores?: Record<string, number>;
  outcome: 'complete' | 'rework';
  rework_notes?: string;
}

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

import { INSPECTION_CHECKLIST_ITEMS } from './inspection-checklist.js';
import { z } from 'zod';

const criteriaScoresShape = z
  .record(z.enum(INSPECTION_CHECKLIST_ITEMS), z.coerce.number().int().min(0).max(100))
  .optional();

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
  // Same requirement as the mobile path: a check always says which room.
  room_number: z.string().trim().min(1, 'A room number is required').max(64),
  // TREQ-005 checklist, accepted here since the Rating merge (2026-08-29):
  // this endpoint is the web's inspection write, and without it the web could
  // no longer record a checklist at all while mobile still could.
  //
  // Accepts BOTH shapes on purpose. The web posts multipart (a photo travels
  // with it) and so JSON-stringifies the object into one field; a JSON caller
  // sends the object itself. `.pipe` runs the same key/range validation over
  // whichever arrived.
  criteria_scores: z
    .union([
      z.string().transform((raw, ctx) => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'criteria_scores must be valid JSON' });
          return z.NEVER;
        }
      }),
      z.record(z.string(), z.unknown()),
    ])
    .pipe(criteriaScoresShape)
    .optional(),
});

export interface CreateQualityVerificationRequest {
  room_number: string;
  criteria_scores?: Record<string, number>;
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
// CreateRatingSchema / CreateRatingRequest were removed 2026-08-29 with the
// Rating model. The checklist they validated (`criteria_scores`) is now part
// of RecordInspectionSchema below and lands on QualityVerification.

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
  // Free-text search across room, notes, worker name and hotel name (owner
  // decision, 2026-08-29). Capped so a pathological string cannot become an
  // expensive LIKE across five columns, and trimmed so a stray space does not
  // silently return nothing.
  q: z.string().trim().max(120).optional(),
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
  // Required (owner decision, 2026-08-29). With many checks per shift, a check
  // that does not say which room it is about cannot be acted on or found.
  // Trimmed so a space is not a room.
  room_number: z.string().trim().min(1, 'A room number is required').max(64),
  score: z.coerce.number().int().min(0).max(100),
  comment: z.string().optional(),
  // Piped through criteriaScoresShape, NOT a bare z.record(z.string(), ...).
  // That shape restricts keys to INSPECTION_CHECKLIST_ITEMS; a permissive
  // record would let a client invent checklist keys that then sit in the
  // database forever, unreadable by any label the apps know how to render.
  // It is also what mobile's inspection-checklist-match-server test reads to
  // pin the two lists together.
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
    .pipe(criteriaScoresShape)
    .optional(),
  outcome: z.enum(['complete', 'rework']),
  // Defaults to `comment` in the service: the checker app asks the question
  // once, and the answer is what the worker is sent.
  rework_notes: z.string().optional(),
  // The worker's own RoomLog this check covers (2026-09-01), when the checker
  // came through the room picker -- which is now the normal path.
  //
  // OPTIONAL, and deliberately not a replacement for the three fields above:
  //  - the picker's "not on the list" fallback inspects a room nobody logged,
  //    so there is no log id to send;
  //  - the service CROSS-CHECKS this log against assignment_id / worker_id /
  //    room_number rather than trusting either side alone, so a client that
  //    mixes up two rooms is rejected instead of silently attributing one
  //    worker's inspection to another's room.
  room_log_id: z.string().min(1).optional(),
});

export interface RecordInspectionRequest {
  assignment_id: string;
  worker_id: string;
  room_number: string;
  score: number;
  comment?: string;
  criteria_scores?: Record<string, number>;
  outcome: 'complete' | 'rework';
  rework_notes?: string;
  room_log_id?: string;
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
// Staged on disk by multer.diskStorage (2026-09-03), not held in memory as a
// Buffer -- see quality/routes.ts for why (one inspection could pin 60 MB of
// heap). The service streams from `path` and is responsible for unlinking it.
export interface UploadedPhoto {
  /** Absolute path to multer's temp file. The service MUST unlink this. */
  path: string;
  /** Bytes multer actually wrote. Used for the size check and as S3's ContentLength. */
  size: number;
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

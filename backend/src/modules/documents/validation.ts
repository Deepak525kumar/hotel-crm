// SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16 Decided 2026-07-27).
// REQ-DOC-017 / RULE-DOC-09: file-type and size validation for the
// POST /workers/:worker_id/documents request body. Shared upload policy
// (allowed MIME types, max size) lives in upload-policy.ts, not here — this
// file holds only the request-body Zod schema, which is specific to this
// module's own route shape (category/filename/expiry), not shared with HR's
// contract-scan mechanism-class upload.

import { z } from 'zod';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from './upload-policy.js';

export { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES };

// file_size_bytes is deliberately NOT part of this schema: with multipart
// upload wired (PR #247), the byte count is derived server-side from the
// parsed file (req.file.size), never trusted from a client-supplied field
// (RULE-DOC-09 provenance discipline — the same reasoning already applied to
// s3_key/actor_id).
import { DocumentCategory } from '@prisma/client';

export const uploadDocumentSchema = z.object({
  category: z.nativeEnum(DocumentCategory),
  original_filename: z.string().min(1).max(255),
  mime_type: z.enum(ALLOWED_MIME_TYPES as unknown as [string, ...string[]]),
  is_work_permit: z
    .preprocess((val) => (val === 'true' ? true : val === 'false' ? false : val), z.boolean())
    .optional(),
  expires_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expires_at must be YYYY-MM-DD')
    .optional(),
});

export type UploadDocumentBody = z.infer<typeof uploadDocumentSchema>;

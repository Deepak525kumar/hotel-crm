// SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16 Decided 2026-07-27).
// REQ-DOC-017 / RULE-DOC-09: file-type and size validation for all upload paths.
// Allowed content types and max size are stated explicitly here rather than
// silently deferred (OD-DOC-016 covers malware scanning, explicitly deferred).

import { z } from 'zod';

// REQ-DOC-017 / RULE-DOC-09: confirmed allowed MIME types for worker document uploads.
// Rationale: identity/residence documents are typically PDFs or images. No broader
// type set is specified by CRR/PDD — the smallest set that covers the confirmed use
// cases is used (Constitution §6: don't invent scope).
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

// REQ-DOC-017: maximum file size (10 MB). Not specified by CRR/PDD; chosen as a
// generous-but-bounded limit consistent with identity/residence document sizes.
// Adjustable without a schema migration.
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const uploadDocumentSchema = z.object({
  category: z.enum(['GENERAL', 'WORK_PERMIT']),
  original_filename: z.string().min(1).max(255),
  mime_type: z.enum(ALLOWED_MIME_TYPES as unknown as [string, ...string[]]),
  file_size_bytes: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  is_work_permit: z.boolean().optional(),
  expires_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expires_at must be YYYY-MM-DD')
    .optional(),
});

export type UploadDocumentBody = z.infer<typeof uploadDocumentSchema>;

// SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16 Decided 2026-07-27).
// REQ-DOC-017 / RULE-DOC-09: file-type and size validation for all upload
// paths across the platform, including the HR contract-scan mechanism-class
// case (RULE-DOC-04, RULE-HR-13 — "mechanically treated like any other
// document upload," CRR §9). Extracted from validation.ts (which also holds
// documents-route-specific request-body schema, not shared policy) so that
// backend-hr depends on this module's declared upload policy rather than on
// another module's route-validation implementation file.

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

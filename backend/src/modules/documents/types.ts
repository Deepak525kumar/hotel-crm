// SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16 Decided 2026-07-27).
// DocumentCategory enum values match schema.prisma exactly.

export type DocumentCategoryType = 'TAX_NUMBER' | 'SOCIAL_SECURITY_NUMBER' | 'HEALTH_INSURANCE' | 'ID_CARD' | 'PASSPORT' | 'ADDRESS' | 'WORK_PERMIT' | 'CONTRACT_SCAN';

// REQ-DOC-011: canonical entity name is WorkerDocument (PDD §9.3 line 389).
export interface WorkerDocumentDto {
  id: string;
  worker_id: string;
  uploaded_by_id: string;
  category: DocumentCategoryType;
  // s3_key is intentionally NOT exposed in client-facing DTOs (OD-DOC-017:
  // bucket exposure posture; key serves as an internal storage reference only).
  // Clients receive a presigned_url instead (REQ-DOC-007 / OD-DOC-018).
  presigned_url: string | null; // null when URL generation is deferred/unavailable
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  // REQ-DOC-001: expiry tracking. null = no expiry set. OD-DOC-003 (open):
  // consequence on expiry-crossing is not yet specified.
  expires_at: string | null;
  // REQ-DOC-003: true only for non-EU/EEA/Swiss workers' work-permit documents.
  is_work_permit: boolean;
  created_at: string;
  updated_at: string;
}

// GD-16 / REQ-DOC-002 / REQ-DOC-005: completeness query response.
// Documents exposes this fact; Onboarding consumes it to drive the chatbot re-prompt.
export interface DocumentCompleteness {
  worker_id: string;
  // Whether the non-EU work-permit branch applies for this worker.
  // Determined by is_work_permit_required (derived from worker's nationality).
  work_permit_required: boolean;
  // True only when all required categories are present (all mandatory + work permit if required)
  is_complete: boolean;
  missing_categories: DocumentCategoryType[];
  // ADR-065 §6 item 8: Checklist shape
  categories: Record<DocumentCategoryType, boolean>;
  document_count: number;
}

// Upload input: file metadata passed from the multipart handler to the service.
// The actual file bytes are passed separately as a Buffer.
// actor_id is ALWAYS derived from req.auth (RULE-DOC-08) — never a client field.
export interface UploadDocumentInput {
  worker_id: string;
  // actor_id: the authenticated uploader — set by the controller from req.auth.userId.
  // Never accepted from the request body (RULE-DOC-08).
  actor_id: string;
  category: DocumentCategoryType;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  // REQ-DOC-003: if this is a work-permit document for a non-EU/EEA/Swiss worker.
  is_work_permit?: boolean;
  // REQ-DOC-001: optional expiry, ISO date string (YYYY-MM-DD).
  expires_at?: string;
}

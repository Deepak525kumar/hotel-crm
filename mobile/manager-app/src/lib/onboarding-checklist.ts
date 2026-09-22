import type { DocumentCategory, DocumentCompleteness, WorkerDocument } from '@hotel-crm/mobile-shared';

/**
 * The onboarding document checklist, mirroring the server's completeness rules
 * (backend documents/service.ts computeCompleteness).
 *
 * Mirrored rather than rendered straight from `missing_categories` because that
 * array cannot express the ID_CARD/PASSPORT rule: the server pushes BOTH when
 * neither is present, so a naive rendering shows two rows for one either/or
 * requirement and none once either is uploaded. The server stays authoritative
 * for `is_complete`; this only decides what to draw.
 */
export interface ChecklistEntry {
  key: string;
  /** Categories that satisfy this row — more than one only for ID/passport. */
  categories: DocumentCategory[];
  labelKey: string;
  document: WorkerDocument | null;
}

const ROWS: { key: string; labelKey: string; categories: DocumentCategory[] }[] = [
  { key: 'ID_CARD', labelKey: 'documents.categoryID_CARD', categories: ['ID_CARD'] },
  { key: 'PASSPORT', labelKey: 'documents.categoryPASSPORT', categories: ['PASSPORT'] },
  { key: 'ADDRESS', labelKey: 'documents.categoryADDRESS', categories: ['ADDRESS'] },
  { key: 'TAX_NUMBER', labelKey: 'documents.categoryTAX_NUMBER', categories: ['TAX_NUMBER'] },
  { key: 'SOCIAL_SECURITY_NUMBER', labelKey: 'documents.categorySOCIAL_SECURITY_NUMBER', categories: ['SOCIAL_SECURITY_NUMBER'] },
  { key: 'HEALTH_INSURANCE', labelKey: 'documents.categoryHEALTH_INSURANCE', categories: ['HEALTH_INSURANCE'] },
];

const WORK_PERMIT_ROW = {
  key: 'WORK_PERMIT',
  labelKey: 'documents.categoryWORK_PERMIT',
  categories: ['WORK_PERMIT'] as DocumentCategory[],
};

/** Newest, not first: re-uploading is how a bad scan gets corrected. */
function newestIn(documents: WorkerDocument[], categories: DocumentCategory[]): WorkerDocument | null {
  const matches = documents.filter((d) => categories.includes(d.category));
  return matches.length ? matches.reduce((a, b) => (b.created_at > a.created_at ? b : a)) : null;
}

export function buildChecklist(
  documents: WorkerDocument[],
  completeness: DocumentCompleteness | null,
): ChecklistEntry[] {
  // Only the server knows whether a work permit applies. Absent completeness,
  // omit the row rather than inventing a requirement nobody can clear.
  const rows = completeness?.work_permit_required ? [...ROWS, WORK_PERMIT_ROW] : ROWS;
  return rows.map((r) => ({ ...r, document: newestIn(documents, r.categories) }));
}

/**
 * Prefers the server's verdict — it owns the rule. The local checklist is the
 * fallback for a failed completeness call, so a transient error does not strand
 * a worker who has uploaded everything.
 */
export function canSubmitForReview(
  entries: ChecklistEntry[],
  completeness: DocumentCompleteness | null,
): boolean {
  return completeness ? completeness.is_complete : entries.every((e) => e.document !== null);
}

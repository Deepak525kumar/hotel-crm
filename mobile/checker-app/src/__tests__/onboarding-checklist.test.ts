import { buildChecklist, canSubmitForReview } from '@/lib/onboarding-checklist';
import type { DocumentCategory, DocumentCompleteness, WorkerDocument } from '@/types/api';

function doc(category: DocumentCategory, created_at: string, id = `${category}-${created_at}`): WorkerDocument {
  return {
    id,
    worker_id: 'w1',
    uploaded_by_id: 'w1',
    category,
    presigned_url: 'https://example.test/x',
    original_filename: `${category}.pdf`,
    mime_type: 'application/pdf',
    file_size_bytes: 1024,
    expires_at: null,
    is_work_permit: false,
    created_at,
    updated_at: created_at,
  } as WorkerDocument;
}

function completeness(over: Partial<DocumentCompleteness> = {}): DocumentCompleteness {
  return {
    worker_id: 'w1',
    work_permit_required: false,
    is_complete: false,
    missing_categories: [],
    categories: {} as DocumentCompleteness['categories'],
    document_count: 0,
    ...over,
  };
}

describe('buildChecklist', () => {
  it('lists the six always-required rows when no work permit is needed', () => {
    const entries = buildChecklist([], completeness());
    expect(entries.map((e) => e.key)).toEqual([
      'ID_CARD',
      'PASSPORT',
      'ADDRESS',
      'TAX_NUMBER',
      'SOCIAL_SECURITY_NUMBER',
      'HEALTH_INSURANCE',
    ]);
  });

  it('adds the work permit row only when the server says it is required', () => {
    const entries = buildChecklist([], completeness({ work_permit_required: true }));
    expect(entries.map((e) => e.key)).toContain('WORK_PERMIT');
  });



  // Re-uploading is how a worker fixes a bad scan; the row must show the
  // replacement rather than the mistake.
  it('shows the newest document when a category was re-uploaded', () => {
    const entries = buildChecklist(
      [doc('ADDRESS', '2026-08-01T00:00:00Z', 'old'), doc('ADDRESS', '2026-08-20T00:00:00Z', 'new')],
      completeness(),
    );
    const address = entries.find((e) => e.key === 'ADDRESS');
    expect(address?.document?.id).toBe('new');
  });

  it('does not invent a work permit requirement when completeness is unavailable', () => {
    const entries = buildChecklist([], null);
    expect(entries.map((e) => e.key)).not.toContain('WORK_PERMIT');
  });
});

describe('canSubmitForReview', () => {
  it('defers to the server verdict when completeness is known', () => {
    const entries = buildChecklist([], completeness({ is_complete: true }));
    expect(canSubmitForReview(entries, completeness({ is_complete: true }))).toBe(true);
  });

  it('blocks when the server says incomplete, even if the local rows look filled', () => {
    const all: WorkerDocument[] = [
      doc('ID_CARD', '2026-08-01T00:00:00Z'),
      doc('ADDRESS', '2026-08-01T00:00:00Z'),
      doc('TAX_NUMBER', '2026-08-01T00:00:00Z'),
      doc('SOCIAL_SECURITY_NUMBER', '2026-08-01T00:00:00Z'),
      doc('HEALTH_INSURANCE', '2026-08-01T00:00:00Z'),
    ];
    const c = completeness({ is_complete: false });
    expect(canSubmitForReview(buildChecklist(all, c), c)).toBe(false);
  });

  // A failed completeness call must not strand a worker who has uploaded
  // everything, nor let an empty checklist through.
  it('falls back to the local checklist when completeness is unavailable', () => {
    expect(canSubmitForReview(buildChecklist([], null), null)).toBe(false);
    const all: WorkerDocument[] = [
      doc('ID_CARD', '2026-08-01T00:00:00Z'),
      doc('PASSPORT', '2026-08-01T00:00:00Z'),
      doc('ADDRESS', '2026-08-01T00:00:00Z'),
      doc('TAX_NUMBER', '2026-08-01T00:00:00Z'),
      doc('SOCIAL_SECURITY_NUMBER', '2026-08-01T00:00:00Z'),
      doc('HEALTH_INSURANCE', '2026-08-01T00:00:00Z'),
    ];
    expect(canSubmitForReview(buildChecklist(all, null), null)).toBe(true);
  });
});

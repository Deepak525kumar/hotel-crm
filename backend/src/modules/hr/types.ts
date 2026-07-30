// SPEC-HR-001 (REVIEW @0.2.9; ADR-012/ADR-014 bounded context).
// Target-state shapes per ADR-039 (2026-07-28, resolving OD-HR-02):
// CreateContractRequest carries no salary/compensation field; the
// payslip-request shape carries no gross-salary/wage-computation field of
// any kind — backend-hr never computes payroll (request-tracking only).

export type ContractStatusType = 'PENDING' | 'ACTIVE' | 'EXTENDED' | 'PERMANENT';

export interface CreateContractRequest {
  worker_id: string;
  template_id: string;
  position: string;
  start_date: string; // ISO date (YYYY-MM-DD)
  end_date?: string; // ISO date (YYYY-MM-DD)
}

export interface ContractDto {
  id: string;
  worker_id: string;
  template_id: string;
  position: string;
  start_date: string;
  end_date: string | null;
  status: ContractStatusType;
  // generated_pdf_key is intentionally NOT exposed (matches WorkerDocumentDto's
  // s3_key omission convention, OD-DOC-017) — internal storage reference only.
  scanned_document_id: string | null;
  confirmed_by_id: string | null;
  confirmed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListContractsQuery {
  worker_id?: string;
  status?: ContractStatusType;
}

export type PayslipRequestStatusType = 'REQUESTED' | 'FULFILLED';

// ADR-039: request-only tracking. No gross_salary/pay-computation field.
export interface CreatePayslipRequestRequest {
  worker_id: string;
  period_start: string; // ISO date (YYYY-MM-DD)
  period_end: string; // ISO date (YYYY-MM-DD)
}

export interface PayslipRequestDto {
  id: string;
  worker_id: string;
  period_start: string;
  period_end: string;
  status: PayslipRequestStatusType;
  fulfilled_by_id: string | null;
  fulfilled_at: string | null;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListPayslipRequestsQuery {
  worker_id?: string;
  status?: PayslipRequestStatusType;
}

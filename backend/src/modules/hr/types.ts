import { z } from 'zod';

// Page-size bounds for this module's list routes, matching
// employee-management/constants.ts's DEFAULT_PAGE_SIZE/MAX_PAGE_SIZE so the
// two modules' list endpoints behave identically.
export const HR_DEFAULT_PAGE_SIZE = 50;
export const HR_MAX_PAGE_SIZE = 100;

// SPEC-HR-001 (REVIEW @0.2.9; ADR-012/ADR-014 bounded context).
// Target-state shapes per ADR-039 (2026-07-28, resolving OD-HR-02):
// CreateContractRequest carries no salary/compensation field; the
// payslip-request shape carries no gross-salary/wage-computation field of
// any kind — backend-hr never computes payroll (request-tracking only).

export type ContractStatusType = 'PENDING' | 'ACTIVE' | 'EXTENDED' | 'PERMANENT';

// 2026-08-13 contract feature: mandatory full-time/part-time marking,
// mirrors EmploymentRecord.employment_type (schema.prisma).
export type EmploymentTypeValue = 'FULL_TIME' | 'PART_TIME';

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
  employment_type: EmploymentTypeValue;
  // generated_pdf_key is intentionally NOT exposed (matches WorkerDocumentDto's
  // s3_key omission convention, OD-DOC-017) — internal storage reference only.
  scanned_document_id: string | null;
  /**
   * True when a signed copy of THIS contract is on file — by either upload
   * path: the manager-posted contract-scan (scanned_document_id) or the
   * applicant's own CONTRACT_SCAN document upload, which writes no Contract
   * column. Consumers must render "signed copy received" from this, never
   * from scanned_document_id alone.
   */
  signed_scan_uploaded: boolean;
  confirmed_by_id: string | null;
  confirmed_at: string | null;
  expires_at: string | null;
  // 2026-08-13 re-onboarding: DERIVED, not stored. Nothing in this codebase
  // ever transitions a Contract out of ACTIVE when its expiry passes --
  // sendExpiryReminders() only reads expires_at to notify, and RULE-HR-06's
  // extend/permanent path is a manual manager action. So "is this contract
  // still valid" cannot be answered by `status` alone: a contract can be
  // ACTIVE and long past expires_at. Both re-onboarding (does this person
  // need a new contract?) and the approve gate depend on the same question,
  // so it is computed once here (isContractValid, hr/service.ts) rather
  // than re-derived per caller.
  is_valid: boolean;
  is_expired: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListContractsQuery {
  worker_id?: string;
  status?: ContractStatusType;
  page?: number;
  limit?: number;
}

// Express hands every query param over as a STRING, and both list services
// below pass page/limit straight into Prisma's skip/take, which require
// numbers -- an unvalidated `?limit=20` reaches `take: "20"` and Prisma
// rejects it at runtime. `z.coerce` is what converts them; the bounds stop
// `?limit=1000000` from becoming an unbounded table scan. Mirrors
// employee-management's BlocklistQuerySchema exactly.
export const ListContractsQuerySchema = z.object({
  worker_id: z.string().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'EXTENDED', 'PERMANENT']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(HR_MAX_PAGE_SIZE).default(HR_DEFAULT_PAGE_SIZE),
});

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
  page?: number;
  limit?: number;
}

// See ListContractsQuerySchema for why coercion is required here.
export const ListPayslipRequestsQuerySchema = z.object({
  worker_id: z.string().optional(),
  status: z.enum(['REQUESTED', 'FULFILLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(HR_MAX_PAGE_SIZE).default(HR_DEFAULT_PAGE_SIZE),
});

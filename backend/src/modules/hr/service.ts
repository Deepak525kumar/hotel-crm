// SPEC-HR-001 (REVIEW @0.2.9; ADR-012/ADR-014 bounded context): backend-hr
// is the exclusive owner of the contract-lifecycle and payslip-request
// capability (Onboarding/employee-management consume, never own — ADR-012
// Decision §3). This service implements the contract-lifecycle half
// (IF-HR-CreateContract, IF-HR-ListContracts, IF-HR-GetContractStatus);
// payroll/payslip (IF-HR-RequestPayslip/IF-HR-FulfilPayslipRequest) remains
// NotImplementedError until PR 4, and signed-upload/manager-confirmation
// (IF-HR-UploadSignedContract/IF-HR-ConfirmContractSigned) until PR 3.
//
// OD-HR-02b (resolved, HR boundary review): contract generation reads
// Personalfragebogen-sourced data from the PERSISTED employee-management
// record (EmploymentRecord.personal_data), not a transient Onboarding
// source — SPEC-EMP-001's own REQ-EMP-011 already designs EmploymentRecord
// as that persisted store, no onboarding module exists in code, and CRR §6
// (signup) precedes CRR §9 (contract, post-familiarization) so the data is
// already persisted by generation time. Read via Prisma directly
// (this.prisma.employmentRecord.findUnique), the same already-established
// cross-module read pattern calendar/service.ts and job-requests/service.ts
// use (ADR-012/ADR-032: direct in-process reads are the platform standard;
// HR does not duplicate employee-management's state, only reads it).
//
// PDF rendering scope (HR implementation PR 2): IF-HR-GenerateContract
// reserves a server-generated storage key for the eventual PDF and creates
// the Contract row (status PENDING) — it does NOT render actual PDF bytes.
// No PDF-template-rendering library is a backend dependency; CRR/PDD do not
// specify a template engine. This is an explicit, disclosed deferred gap
// (same pattern as Documents' own deferred multipart-upload/malware-scan
// gaps), not a silent omission — confirmed with the commissioning human
// before this PR was written.

import { ContractStatus } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ForbiddenError, NotFoundError, NotImplementedError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { documentService } from '../documents/service.js';
import { generateStorageKey } from '../documents/storage.js';
import type {
  CreateContractRequest,
  ContractDto,
  ContractStatusType,
  ListContractsQuery,
} from './types.js';

export class HrService extends BaseService {
  // ---------------------------------------------------------------------------
  // IF-HR-CreateContract (RULE-HR-01/REQ-HR-001, generation half)
  // ---------------------------------------------------------------------------
  // ADR-039: no salary/compensation field — document production only.
  // OD-HR-02b: reads Personalfragebogen data from the persisted
  // employee-management record (EmploymentRecord.personal_data), not a
  // transient Onboarding source.
  async createContract(data: CreateContractRequest): Promise<ContractDto> {
    if (!data.worker_id || !data.template_id || !data.position || !data.start_date) {
      throw new ValidationError('worker_id, template_id, position, and start_date are required');
    }

    // OD-HR-02b: read the persisted Personalfragebogen data. A missing
    // EmploymentRecord means the confirmed prerequisite data (CRR §6, prior
    // to CRR §9's contract step) does not exist yet — REQ-HR-001's own
    // failure mode ("Missing Personalfragebogen data").
    const employmentRecord = await this.prisma.employmentRecord.findUnique({
      where: { user_id: data.worker_id },
      select: { personal_data: true },
    });
    if (!employmentRecord) {
      throw new NotFoundError('No employment record found for this worker — Personalfragebogen data unavailable');
    }
    if (employmentRecord.personal_data === null || employmentRecord.personal_data === undefined) {
      throw new ValidationError('Personalfragebogen data has not been recorded for this worker yet');
    }

    // RULE-HR-13/RULE-DOC-09 convention: server-generated key, never client
    // input. Reuses Documents' key-generation helper (same guessing-resistant
    // shape) rather than inventing a second one; no bytes are written yet
    // (PDF-rendering scope note above).
    const generatedPdfKey = generateStorageKey(data.worker_id, 'contract', `${data.template_id}.pdf`);

    const contract = await this.prisma.contract.create({
      data: {
        worker_id: data.worker_id,
        template_id: data.template_id,
        position: data.position,
        start_date: new Date(`${data.start_date}T00:00:00.000Z`),
        end_date: data.end_date ? new Date(`${data.end_date}T00:00:00.000Z`) : null,
        status: ContractStatus.PENDING,
        generated_pdf_key: generatedPdfKey,
      },
    });

    logger.info('hr_contract_created', { contractId: contract.id, workerId: data.worker_id });

    return this.toDto(contract);
  }

  // ---------------------------------------------------------------------------
  // IF-HR-ListContracts
  // ---------------------------------------------------------------------------
  // OD-HR-13: route-level scoping (checkWorkerScope()/Admin-only) is enforced
  // in routes.ts, matching every other HR route's existing pattern — this
  // service method performs no additional actor-based filtering.
  async listContracts(filters: ListContractsQuery = {}): Promise<ContractDto[]> {
    const contracts = await this.prisma.contract.findMany({
      where: {
        ...(filters.worker_id ? { worker_id: filters.worker_id } : {}),
        ...(filters.status ? { status: filters.status as ContractStatus } : {}),
      },
      orderBy: { created_at: 'desc' },
    });
    return contracts.map((c) => this.toDto(c));
  }

  // ---------------------------------------------------------------------------
  // IF-HR-GetContractStatus
  // ---------------------------------------------------------------------------
  // OD-HR-10 (FIND-SEC-HR-03, IDOR risk): a WORKER-role caller MUST be
  // scoped to their own identity — never satisfied by a client-supplied
  // worker_id for that role. Manager/Admin scoping is enforced in routes.ts
  // via checkWorkerScope()/requireRole, matching the platform's existing
  // convention; this defence-in-depth check additionally guards the
  // worker-self-read path, which carries no checkWorkerScope() call today.
  async getContractStatus(
    workerId: string,
    actorId: string,
    actorRole: string
  ): Promise<ContractDto | null> {
    if (actorRole === 'worker' && actorId !== workerId) {
      throw new ForbiddenError('Workers may only view their own contract status');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { worker_id: workerId },
      orderBy: { created_at: 'desc' },
    });
    return contract ? this.toDto(contract) : null;
  }

  async createPayroll(_data: Record<string, unknown>) {
    throw new NotImplementedError('HR payslip requests are not yet implemented');
  }

  async listPayroll(_filters?: Record<string, unknown>) {
    throw new NotImplementedError('HR payslip requests are not yet implemented');
  }

  // MIG-GAP-DOC-001 (RULE-DOC-04, OD-DOC-015): the contract-scan upload is
  // "mechanically treated like any other document upload" (CRR §9) — this
  // module owns no upload mechanism of its own; it delegates the actual
  // storage/validation/persistence to backend-documents' DocumentService,
  // an in-process call (same pattern as calendar's AssignmentService.update()
  // call), not a new cross-module HTTP round-trip. HR gains no document
  // lifecycle authority by doing so (RULE-DOC-04); contract status/
  // confirmation semantics remain exclusively HR's, and are unaffected by
  // this delegation (out of scope here — no IF-HR-ConfirmContractSigned
  // exists yet; that is a separate target-state interface, not built by
  // this migration).
  //
  // Category: SPEC-DOCUMENTS-001's only two ratified categories are GENERAL
  // and WORK_PERMIT (OD-DOC-005's category-taxonomy half remains Open,
  // non-blocking, no CONTRACT_SCAN category exists). The contract scan is
  // classified GENERAL, consistent with CRR §9's own framing of it as "one
  // document type among others" — not a new category invented here.
  async uploadDocument(
    workerId: string,
    file: Buffer,
    originalFilename: string,
    mimeType: string,
    actorId: string,
    actorRole: string,
    actorIp?: string
  ) {
    return documentService.uploadDocument(
      {
        worker_id: workerId,
        actor_id: actorId,
        category: 'GENERAL',
        original_filename: originalFilename,
        mime_type: mimeType,
        file_size_bytes: file.length,
      },
      file,
      actorRole,
      actorIp
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  private toDto(contract: {
    id: string;
    worker_id: string;
    template_id: string;
    position: string;
    start_date: Date;
    end_date: Date | null;
    status: ContractStatus;
    scanned_document_id: string | null;
    confirmed_by_id: string | null;
    confirmed_at: Date | null;
    expires_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }): ContractDto {
    return {
      id: contract.id,
      worker_id: contract.worker_id,
      template_id: contract.template_id,
      position: contract.position,
      start_date: contract.start_date.toISOString().slice(0, 10),
      end_date: contract.end_date ? contract.end_date.toISOString().slice(0, 10) : null,
      status: contract.status as ContractStatusType,
      scanned_document_id: contract.scanned_document_id,
      confirmed_by_id: contract.confirmed_by_id,
      confirmed_at: contract.confirmed_at ? contract.confirmed_at.toISOString() : null,
      expires_at: contract.expires_at ? contract.expires_at.toISOString() : null,
      created_at: contract.created_at.toISOString(),
      updated_at: contract.updated_at.toISOString(),
    };
  }
}

export const hrService = new HrService();

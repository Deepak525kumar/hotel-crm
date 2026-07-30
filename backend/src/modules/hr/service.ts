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
//
// HR implementation PR 3 (RULE-HR-03/13/14/15, ADR-044): uploadSignedContract
// and confirmContractSigned. Both interfaces are keyed on worker_id only
// (no contract_id param in SPEC-HR-001's own Interfaces table) — resolved
// against the worker's current PENDING contract, consistent with the
// confirmed one-lifecycle-per-worker state machine
// ((none) -> Pending -> signed/active -> extended -> permanent, State and
// Lifecycle section) and RULE-HR-03's "no other actor may flip this status"
// framing. Storage delegates to backend-documents' generic upload mechanism
// (RULE-DOC-04) via a direct in-process call, same as the pre-existing
// uploadDocument() method below — HR gains no document-lifecycle authority
// by doing so; only contract status/confirmation semantics are HR's own.
//
// ADR-044's malware-scan hook (RULE-HR-13/OD-HR-14) is real control flow
// (reject-on-detection) with a disclosed pass-through default scanner — see
// malware-scan.ts's own header comment; no vendor/library has been chosen.

import { ContractStatus } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ForbiddenError, NotFoundError, NotImplementedError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { documentService } from '../documents/service.js';
import { generateStorageKey } from '../documents/storage.js';
import { getMalwareScanner } from './malware-scan.js';
import type {
  CreateContractRequest,
  ContractDto,
  ContractStatusType,
  ListContractsQuery,
} from './types.js';

// Architectural assumption (review note, not a defect): this service's
// worker-scoped Contract lookups (getContractStatus, and PR 3/4/5's
// uploadSignedContract/confirmContractSigned/extendContract/
// manualLapseContract) resolve their target contract as
// `findFirst({ where: { worker_id, status: ... }, orderBy: { created_at:
// 'desc' } })` — implicitly assuming at most one PENDING (or one
// ACTIVE/EXTENDED) contract per worker at a time. This is correct and
// consistent with SPEC-HR-001's currently confirmed one-lifecycle-per-worker
// state machine ((none) -> Pending -> signed/active -> extended ->
// permanent, REQ-HR-006: "no other lifecycle values exist," no concurrent-
// contract concept anywhere in CRR/PDD). No schema constraint enforces this
// today (Contract carries no unique index on worker_id), so it is a
// business-rule assumption, not a database-level invariant. If the business
// model later allows concurrent draft/pending contracts for the same
// worker (e.g. a renewal negotiated before the current contract expires),
// every findFirst-by-worker-and-status call site in this file will need to
// evolve — most likely to accept an explicit contract id rather than
// inferring "the" contract from worker_id + status alone.
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

  // ---------------------------------------------------------------------------
  // IF-HR-UploadSignedContract (RULE-HR-03/13, REQ-HR-014/015, ADR-044)
  // ---------------------------------------------------------------------------
  // RULE-HR-14: manager identity MUST be derived from the authenticated
  // session (actorId param below), never a client-supplied field — enforced
  // by the controller reading req.auth, not accepting it in the request body.
  // RULE-HR-13/ADR-044: reject on malware-scan detection, before persistence.
  async uploadSignedContract(
    workerId: string,
    file: Buffer,
    originalFilename: string,
    mimeType: string,
    actorId: string,
    actorRole: string,
    actorIp?: string
  ): Promise<ContractDto> {
    const contract = await this.prisma.contract.findFirst({
      where: { worker_id: workerId, status: ContractStatus.PENDING },
      orderBy: { created_at: 'desc' },
    });
    if (!contract) {
      throw new NotFoundError('No pending contract found for this worker to upload a scan against');
    }

    // ADR-044: synchronous scan, before the file is persisted anywhere.
    const scanResult = await getMalwareScanner().scan(file);
    if (!scanResult.clean) {
      throw new ValidationError(
        `Uploaded file failed the malware scan${scanResult.reason ? `: ${scanResult.reason}` : ''}`
      );
    }

    // MIG-GAP-DOC-001/RULE-DOC-04: delegates storage to backend-documents,
    // same in-process-call pattern as the pre-existing uploadDocument()
    // method — HR gains no document-lifecycle authority by doing so.
    const doc = await documentService.uploadDocument(
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

    const updated = await this.prisma.contract.update({
      where: { id: contract.id },
      data: { scanned_document_id: doc.id },
    });

    logger.info('hr_contract_scan_uploaded', { contractId: contract.id, workerId, documentId: doc.id });

    return this.toDto(updated);
  }

  // ---------------------------------------------------------------------------
  // IF-HR-ConfirmContractSigned (RULE-HR-03/05/15, REQ-HR-013/014)
  // ---------------------------------------------------------------------------
  // RULE-HR-14: confirming manager identity MUST be derived from req.auth
  // (actorId param), never client-supplied — controller-enforced.
  // REQ-HR-013/RULE-HR-15: exactly one immutable audit record per
  // confirmation, containing confirming actor id, timestamp, worker id,
  // contract id, and the evidence-file reference — the sole compensating
  // control for the accepted no-signature-verification trust boundary.
  async confirmContractSigned(
    workerId: string,
    actorId: string,
    actorRole: string,
    actorIp?: string
  ): Promise<ContractDto> {
    const contract = await this.prisma.contract.findFirst({
      where: { worker_id: workerId, status: ContractStatus.PENDING },
      orderBy: { created_at: 'desc' },
    });
    if (!contract) {
      throw new NotFoundError('No pending contract found for this worker to confirm');
    }
    // CRR §9 safeguard: confirmation without an uploaded file is rejected.
    if (!contract.scanned_document_id) {
      throw new ValidationError('Cannot confirm a contract with no uploaded signed scan');
    }

    const now = new Date();
    // RULE-HR-05: 1-year expiry clock starts the moment status flips to ACTIVE.
    const expiresAt = new Date(now);
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);

    const updated = await this.prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: ContractStatus.ACTIVE,
        confirmed_by_id: actorId,
        confirmed_at: now,
        expires_at: expiresAt,
      },
    });

    // REQ-HR-013/RULE-HR-15: the sole compensating control for the
    // no-signature-verification trust boundary — all five mandated fields
    // (confirming actor id, timestamp, worker id, contract id, evidence-file
    // reference) via BaseService.logAudit's existing schema. Immutable by
    // construction (AuditLog has no update/delete code path anywhere).
    await this.logAudit(
      actorId,
      actorRole,
      'hr_contract.confirm_signed',
      'Contract',
      contract.id,
      { worker_id: workerId, scanned_document_id: contract.scanned_document_id },
      actorIp
    );

    logger.info('hr_contract_confirmed', { contractId: contract.id, workerId, confirmedBy: actorId });

    return this.toDto(updated);
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

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
//
// HR implementation PR 5 (RULE-HR-06/07, ADR-040/045): extendContract/
// manualLapseContract (manager-only continuation/lapse confirmation, no
// worker-side veto — ADR-040 Decision §1/§3), sendExpiryReminders (scheduled
// job, 1yr/2yr marks, REQ-HR-006/RULE-HR-07). manualLapseContract wires
// ADR-040's PATH (a) only — an explicit manager decline — via a direct
// in-process call to employee-management's new
// deactivateForContractLapse() (ADR-045). PATH (b), silence past a defined
// deadline, is explicitly NOT built here: ADR-040 ratifies that this
// trigger exists but no document anywhere defines the deadline length
// (unlike ADR-041's explicit 3-business-day payslip window) — confirmed
// with the commissioning human before this PR was written; building a
// silence-based auto-lapse job would require inventing that number
// unrequested. This is a disclosed, deferred gap requiring its own future
// product decision, not a silent omission.
//
// ADR-041's payslip-escalation scheduled job is ALSO deferred, discovered
// while building this PR: escalation's real-world target is "the manager's
// own manager, or Admin if no reporting-structure manager exists" — but
// ADR-060 (org-chart, 2026-07-29) ratified a flat, hotel-scoped visibility
// model with NO reporting-tree data structure, meaning the Admin-fallback
// path is the ONLY path that will ever fire in practice, and no
// "notify Admin" mechanism (broadcast, designated recipient, or otherwise)
// exists anywhere in this codebase to build it against. Escalating instead
// to the same Regional-Manager recipient the request/expiry-reminder paths
// already use would silently narrow ADR-041's own intent, not implement it —
// confirmed with the commissioning human before this PR was written; this
// scheduled job (escalateStalePayslipRequests) is deferred pending a
// product/architecture decision on the Admin-notification mechanism, not
// silently substituted.
//
// HR implementation PR 4 (RULE-HR-09/12, ADR-039/041/042/043): requestPayslip,
// listPayroll (lists PayslipRequest records — ADR-039's target shape, no
// payroll computation), createPayroll (Manager/Admin may also create a
// request directly, per IF-HR-CreatePayroll's own actor row), and
// fulfilPayslipRequest. requestPayslip (worker self-submission only) notifies
// the worker's Hotel Group's Regional Manager (EVT-HR-PayslipRequested) via
// the existing Outbox — the identical "responsible manager" resolution
// calendar/service.ts's own notifyManager() already established
// (EmploymentRecord -> HotelGroup -> regional_manager_user_id), same
// best-effort/no-fallback posture (OD-CAL-06 precedent: an unassigned/inactive
// worker has no group, no notification is sent, rather than guessing a
// recipient). createPayroll shares the record-creation logic but deliberately
// does NOT notify — EVT-HR-PayslipRequested's spec-defined trigger
// (RULE-HR-09, Events table) is "Worker requests a payslip," and
// IF-HR-CreatePayroll's own interface row carries no notification
// side-effect; see createPayroll's own comment for the full reasoning.
// ADR-041's 3-business-day auto-escalation to the manager's own manager is a
// separate, scheduled-job concern (PR 5), not built here.

import {
  ContractStatus,
  PayslipRequestStatus,
  EmploymentStatus,
  EmploymentType,
  OutboxTransport,
  OutboxSourceModule,
  Prisma,
} from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BaseService } from '../../lib/base-service.js';

import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { isWorkerInGroupScope, resolveNonAdminScopeFilter } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import type { ServiceActor } from '../../lib/types.js';
import { documentService } from '../documents/service.js';
import { generateStorageKey } from '../documents/storage.js';
import { employeeManagementService } from '../employee-management/service.js';
import { notificationService } from '../notifications/service.js';
import { getMalwareScanner } from './malware-scan.js';
import type {
  CreateContractRequest,
  ContractDto,
  ContractStatusType,
  ListContractsQuery,
  CreatePayslipRequestRequest,
  PayslipRequestDto,
  PayslipRequestStatusType,
  ListPayslipRequestsQuery,
} from './types.js';

// 2026-08-13 contract feature: the single default contract PDF (replaces the
// removed Document Templates module -- see ADR/decision note in
// employee-management/service.ts's createEmployee()). Every worker downloads
// the same static file, marks it FULL_TIME or PART_TIME by hand, signs it,
// and returns it via the pre-existing uploadSignedContract()/
// confirmContractSigned() flow below -- no per-worker rendering.
declare const __dirname: string | undefined;

// Mirrors config/env.ts's backendRoot() dual CJS/ESM resolution exactly (see
// that function's own comment): under ts-jest/CommonJS, `__dirname` is
// provided by the module wrapper (this file lives at
// `backend/src/modules/hr/` -> walk up 3 to `backend/`); under native ESM
// (`node dist/server.js`), `__dirname` does not exist and `import.meta.url`
// is unavailable at this module's target/module tsconfig settings, so the
// entrypoint-relative walk-up-to-package.json fallback is used instead.
function resolveDefaultContractPdfPath(): string {
  if (typeof __dirname !== 'undefined') {
    return resolve(__dirname, '..', '..', '..', 'assets', 'contracts', 'default-contract-template.pdf');
  }
  const entry = process.argv[1];
  let dir = entry ? dirname(resolve(entry)) : process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(resolve(dir, 'package.json'))) {
      return resolve(dir, 'assets', 'contracts', 'default-contract-template.pdf');
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), 'assets', 'contracts', 'default-contract-template.pdf');
}

const DEFAULT_CONTRACT_PDF_PATH = resolveDefaultContractPdfPath();

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
// 2026-08-13 re-onboarding: the single definition of "this contract is still
// valid right now". Deliberately NOT a status check alone -- nothing in this
// codebase ever transitions a Contract out of ACTIVE when its expiry passes
// (sendExpiryReminders() only notifies; RULE-HR-06's extend/permanent step is
// a manual manager action), so an ACTIVE contract can be years past
// expires_at. PERMANENT contracts have expires_at = null by construction
// (RULE-HR-06) and are therefore always valid, which falls out of the null
// check rather than needing its own branch.
//
// Exported so employee-management's approve/rehire gate and the re-onboarding
// UI answer this question identically -- a second, subtly-different copy of
// this predicate is exactly how "reactivate says the contract is fine but
// approve then rejects it" would happen.
export function isContractValid(
  contract: { status: ContractStatus; expires_at?: Date | null } | null | undefined,
  now: Date = new Date()
): boolean {
  if (!contract) return false;
  const statusOk =
    contract.status === ContractStatus.ACTIVE ||
    contract.status === ContractStatus.EXTENDED ||
    contract.status === ContractStatus.PERMANENT;
  if (!statusOk) return false;
  // Absent/null expiry both mean "no expiry set" -> not expired. `expires_at`
  // is nullable AND may simply not have been selected by the caller's query;
  // treating a missing field as expired would silently invalidate contracts
  // based on which columns a query happened to fetch.
  return contract.expires_at == null || contract.expires_at > now;
}

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
      select: { personal_data: true, employment_type: true },
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
        employment_type: employmentRecord.employment_type,
      },
    });

    logger.info('hr_contract_created', { contractId: contract.id, workerId: data.worker_id });

    return this.toDto(contract);
  }

  // ---------------------------------------------------------------------------
  // Default Contract (2026-08-13 feature, replaces Document Templates)
  // ---------------------------------------------------------------------------
  // Auto-invoked by employee-management's createEmployee() the moment an
  // application record is created (see that method's own comment) — there is
  // exactly one contract PDF in this system (assets/contracts/
  // default-contract-template.pdf), so no template_id selection or
  // Personalfragebogen prerequisite applies the way createContract()'s manual
  // HR path requires: the file is static, not rendered per-worker. The
  // applicant downloads it (getDefaultContractPdf below), marks FULL_TIME or
  // PART_TIME by hand exactly as the record's own employment_type says,
  // signs it, and returns it via the existing uploadSignedContract() /
  // confirmContractSigned() flow — manual review, never machine-checked
  // against employment_type.
  //
  // Idempotent by construction: employee-management guards this with a
  // findFirst(worker_id) check of its own before calling, but this method
  // additionally short-circuits if a contract already exists for the worker,
  // so a retried call (e.g. a failed transaction retry) never creates a
  // second row for the same applicant.
  async generateDefaultContract(
    workerId: string,
    jobTitle: string,
    startDate: Date,
    employmentType: EmploymentType
  ): Promise<ContractDto> {
    const existing = await this.prisma.contract.findFirst({ where: { worker_id: workerId } });
    if (existing) {
      return this.toDto(existing);
    }

    return this.createDefaultContract(workerId, jobTitle, startDate, employmentType, 'hr_default_contract_generated');
  }

  /**
   * 2026-08-13 re-onboarding: issues a NEW default contract for a returning
   * employee whose previous one has expired.
   *
   * Distinct from generateDefaultContract() purely in its idempotency rule:
   * that one short-circuits whenever ANY contract exists (correct for
   * first-time onboarding, where a second contract would be a duplicate),
   * which is exactly the wrong behaviour here -- the whole point is that a
   * contract exists and is no longer valid. The expired contract is left in
   * place rather than mutated: it is the historical record of the previous
   * employment cycle, and RULE-HR-06 defines no "expired" status to move it
   * to. `getContractStatus`/`assertApprovedContract` both read the NEWEST
   * contract, so the fresh PENDING row is the one that governs from here.
   *
   * The new contract's start_date is TODAY, not the record's original
   * start_date: a returning employee's new engagement starts now, and dating
   * it from the original hire would produce a contract that is already
   * expired on issue (its 6-month window having elapsed years ago).
   */
  async reissueDefaultContract(
    workerId: string,
    jobTitle: string,
    _originalStartDate: Date,
    employmentType: EmploymentType
  ): Promise<ContractDto> {
    return this.createDefaultContract(
      workerId,
      jobTitle,
      new Date(),
      employmentType,
      'hr_default_contract_reissued'
    );
  }

  /**
   * Stands an active contract down when the employment it belongs to ends or
   * is refused (2026-08-13 audit finding: contract/onboarding desync).
   *
   * HR can confirm a signature independently of the manager's approval
   * decision, so a worker could end up REJECTED or DELETED while still
   * holding a contract the system reported as ACTIVE, with its expiry clock
   * running.
   *
   * Expires the contract rather than introducing a new status: RULE-HR-06 /
   * REQ-HR-006 state that only PENDING/ACTIVE/EXTENDED/PERMANENT are
   * reachable, and adding a fifth ("VOIDED") is a schema and product decision
   * that needs its own ratification -- not something to slip in as part of a
   * bug fix. Setting expires_at to now makes isContractValid() report false
   * immediately through the mechanism that already exists, which is what
   * every gate actually reads. The row itself is preserved as history.
   *
   * Best-effort by design: it must never block the lifecycle transition that
   * triggered it (the rejection/termination is the real outcome).
   */
  async standDownContractsFor(workerId: string, reason: string): Promise<void> {
    try {
      const now = new Date();
      const { count } = await this.prisma.contract.updateMany({
        where: {
          worker_id: workerId,
          status: { in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED, ContractStatus.PERMANENT] },
          OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        },
        data: { expires_at: now },
      });
      if (count > 0) {
        logger.info('hr_contracts_stood_down', { workerId, count, reason });
      }
    } catch (error) {
      logger.error('hr_contract_stand_down_failed', {
        workerId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async createDefaultContract(
    workerId: string,
    jobTitle: string,
    startDate: Date,
    employmentType: EmploymentType,
    logEvent: string
  ): Promise<ContractDto> {
    // 6-month default end date (owner decision, 2026-08-13): editable later
    // via any future contract-update path; not enforced against
    // employment_type (part-time contracts are not required to be shorter).
    const endDate = new Date(startDate);
    endDate.setUTCMonth(endDate.getUTCMonth() + 6);

    const contract = await this.prisma.contract.create({
      data: {
        worker_id: workerId,
        template_id: 'default',
        position: jobTitle,
        start_date: startDate,
        end_date: endDate,
        status: ContractStatus.PENDING,
        employment_type: employmentType,
      },
    });

    logger.info(logEvent, { contractId: contract.id, workerId, employmentType });

    return this.toDto(contract);
  }

  // Serves the single default contract PDF asset. Every worker/manager/RM/
  // admin with read access to the worker's contract may download the same
  // bytes — see hr/routes.ts's requireContractReadAccess() for the identical
  // role/scope gate getContractStatus already uses. Never machine-validated
  // against the worker's employment_type; the applicant marks it by hand and
  // the approving manager reviews the returned scan (RULE-HR-03).
  async getDefaultContractPdf(): Promise<Buffer> {
    try {
      return await readFile(DEFAULT_CONTRACT_PDF_PATH);
    } catch (error) {
      logger.error('hr_default_contract_pdf_missing', {
        path: DEFAULT_CONTRACT_PDF_PATH,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new NotFoundError('The default contract template is not available. Contact an administrator.');
    }
  }

  // ---------------------------------------------------------------------------
  // IF-HR-ListContracts
  // ---------------------------------------------------------------------------
  // ADR-043 (OD-HR-13 list-route half): Admin unscoped; Manager's results are
  // server-side filtered to their own hotel_group_id — the identical
  // resolveNonAdminScopeFilter() primitive users/service.ts's listUsers()
  // already established (ADR-030 PR-4, "filter, don't deny"), reused rather
  // than a new mechanism. `actor` is optional so the pre-PR-4 call shape
  // still compiles; the controller always passes it.
  async listContracts(
    filters: ListContractsQuery = {},
    actor?: ServiceActor
  ): Promise<{ data: ContractDto[]; total: number }> {
    const where: Prisma.ContractWhereInput = {
      ...(filters.worker_id ? { worker_id: filters.worker_id } : {}),
      ...(filters.status ? { status: filters.status as ContractStatus } : {}),
    };

    if (actor && actor.role !== 'admin') {
      const scopeFilter = await resolveNonAdminScopeFilter(actor.role, actor.scope ?? null);
      if (scopeFilter.kind === 'deny') {
        where.worker_id = '__none__';
      } else {
        where.worker = { employment_record: { hotel_group_id: scopeFilter.hotelGroupId } };
      }
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const [contracts, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return { data: contracts.map((c) => this.toDto(c)), total };
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
    if ((actorRole === 'worker' || actorRole === 'checker') && actorId !== workerId) {
      throw new ForbiddenError('Workers may only view their own contract status');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { worker_id: workerId },
      orderBy: { created_at: 'desc' },
    });
    if (!contract) return null;

    // signed_scan_uploaded is what both the applicant's own card and the
    // reviewer's modal render "signed copy received" from -- and it must
    // account for the applicant's self-upload path, not only
    // Contract.scanned_document_id, or the UI reports "not uploaded" for a
    // file the reviewer can see in the document checklist directly above it.
    const scannedDocumentId =
      contract.scanned_document_id ?? (await this.findSignedScanDocumentId(workerId, contract.created_at));

    return this.toDto(contract, scannedDocumentId != null);
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
        category: 'CONTRACT_SCAN',
        original_filename: originalFilename,
        mime_type: mimeType,
        file_size_bytes: file.length,
      },
      file,
      actorRole,
      actorIp,
      // RULE B (2026-08-12) makes worker-document upload self-only. A contract
      // SCAN is not the applicant's own onboarding upload — it is the
      // counterparty's record of an already-signed contract — so it is exempt.
      // Authorization for it is this method's own contract-ownership check
      // above, not the self-check RULE B installs. See
      // documents/service.ts#uploadDocument's note on `systemGenerated`.
      { systemGenerated: true }
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

    // 2026-08-13 fix (reported: "contract is uploaded, still says not
    // uploaded"). There are TWO ways a signed scan reaches the system:
    //   (a) a manager/admin posts it to /hr/workers/:id/contract-scan, which
    //       sets Contract.scanned_document_id, and
    //   (b) the APPLICANT uploads it themselves as a CONTRACT_SCAN
    //       WorkerDocument on My Onboarding (the signed-contract upload
    //       field shipped in #431), which writes no Contract column at all.
    // Path (b) is the one every applicant actually uses, and confirmation
    // read only path (a)'s column -- so the manager saw an uploaded file in
    // the checklist and a "no uploaded signed scan" error on confirm.
    // Resolve the applicant-uploaded scan here and adopt it, rather than
    // teaching the documents module about contracts (HR owns this link).
    const scannedDocumentId =
      contract.scanned_document_id ?? (await this.findSignedScanDocumentId(workerId, contract.created_at));

    // CRR §9 safeguard: confirmation without an uploaded file is rejected.
    if (!scannedDocumentId) {
      throw new ValidationError('Cannot confirm a contract with no uploaded signed scan');
    }

    const now = new Date();
    // RULE-HR-05: 1-year expiry clock starts the moment status flips to ACTIVE.
    const expiresAt = new Date(now);
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);

    const updated = await this.prisma.$transaction(async (tx) => {
      const contractUpdate = await tx.contract.update({
        where: { id: contract.id },
        data: {
          status: ContractStatus.ACTIVE,
          confirmed_by_id: actorId,
          confirmed_at: now,
          expires_at: expiresAt,
          // Persist the adopted applicant-uploaded scan so the evidence
          // reference below (RULE-HR-15) points at a real, stored document
          // for both upload paths, not just the manager-upload one.
          scanned_document_id: scannedDocumentId,
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
        { worker_id: workerId, scanned_document_id: scannedDocumentId },
        actorIp,
        undefined,
        undefined,
        tx
      );

      return contractUpdate;
    });

    logger.info('hr_contract_confirmed', { contractId: contract.id, workerId, confirmedBy: actorId });

    return this.toDto(updated);
  }

  /**
   * The applicant-uploaded signed scan for a contract, if one exists.
   *
   * "For a contract" is a date comparison, not just a category match: a scan
   * uploaded against a PREVIOUS contract says nothing about the current one,
   * which is exactly the re-onboarding case where a fresh contract was just
   * issued. Same predicate employee-management's submit-for-review gate uses,
   * so the two cannot disagree about whether a contract has been signed.
   */
  async findSignedScanDocumentId(workerId: string, contractCreatedAt: Date): Promise<string | null> {
    const doc = await this.prisma.workerDocument.findFirst({
      where: {
        worker_id: workerId,
        category: 'CONTRACT_SCAN',
        created_at: { gte: contractCreatedAt },
      },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });
    return doc?.id ?? null;
  }

  /**
   * Confirms the worker's PENDING contract when the signed scan is already on
   * file, attributing the confirmation to `actorId`.
   *
   * Called by employee-management's approve(): a reviewer approving an
   * application IS the manager reviewing the returned signed contract
   * (RULE-HR-03) -- it is the same human act, and requiring them to walk to a
   * separate HR screen and press a second button is what made the Approve
   * button appear broken (it 409'd on assertApprovedContract every time,
   * because nothing had flipped the contract to ACTIVE).
   *
   * Returns false, without throwing, when there is nothing to confirm (no
   * PENDING contract, or no signed scan yet) -- the caller's own gate then
   * produces the user-facing message, so this method never invents one.
   */
  async confirmSignedContractIfPending(
    workerId: string,
    actorId: string,
    actorRole: string,
    actorIp?: string
  ): Promise<boolean> {
    const contract = await this.prisma.contract.findFirst({
      where: { worker_id: workerId, status: ContractStatus.PENDING },
      orderBy: { created_at: 'desc' },
    });
    if (!contract) return false;

    const scannedDocumentId =
      contract.scanned_document_id ?? (await this.findSignedScanDocumentId(workerId, contract.created_at));
    if (!scannedDocumentId) return false;

    await this.confirmContractSigned(workerId, actorId, actorRole, actorIp);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Contract continuation/permanence (RULE-HR-06/07, ADR-040): manager-only
  // confirmation, no worker-side veto. extendContract handles both the 1yr
  // mark (-> EXTENDED) and 2yr mark (-> PERMANENT); REQ-HR-006 confirms only
  // these four states are reachable, so both transitions share one method
  // rather than two near-duplicates.
  // ---------------------------------------------------------------------------
  async extendContract(
    workerId: string,
    actorId: string,
    actorRole: string
  ): Promise<ContractDto> {
    const contract = await this.prisma.contract.findFirst({
      where: { worker_id: workerId, status: { in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED] } },
      orderBy: { created_at: 'desc' },
    });
    if (!contract) {
      throw new NotFoundError('No active or extended contract found for this worker to extend');
    }

    // RULE-HR-06: ACTIVE (1yr mark) -> EXTENDED; EXTENDED (2yr mark) -> PERMANENT.
    const nextStatus =
      contract.status === ContractStatus.ACTIVE ? ContractStatus.EXTENDED : ContractStatus.PERMANENT;

    const data: Prisma.ContractUpdateInput = { status: nextStatus };
    if (nextStatus === ContractStatus.EXTENDED) {
      // RULE-HR-06: extended one additional year from the current expiry mark.
      const newExpiry = new Date(contract.expires_at ?? new Date());
      newExpiry.setUTCFullYear(newExpiry.getUTCFullYear() + 1);
      data.expires_at = newExpiry;
    } else {
      // RULE-HR-06: permanent, open-ended -- no further expiry reminders.
      data.expires_at = null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const contractUpdate = await tx.contract.update({ where: { id: contract.id }, data });

      await this.logAudit(
        actorId,
        actorRole,
        nextStatus === ContractStatus.EXTENDED ? 'hr_contract.extend' : 'hr_contract.make_permanent',
        'Contract',
        contract.id,
        { worker_id: workerId, from_status: contract.status, to_status: nextStatus },
        undefined,
        undefined,
        undefined,
        tx
      );

      return contractUpdate;
    });

    logger.info('hr_contract_extended', { contractId: contract.id, workerId, nextStatus });

    return this.toDto(updated);
  }

  // ADR-040 Decision §2, PATH (a) only: an explicit manager "do not
  // continue" action. PATH (b) (manager silence past a defined deadline) is
  // explicitly NOT implemented -- see this file's header comment; no
  // document defines that deadline's length. Triggers employee-management's
  // Deactivated transition automatically via a direct in-process call
  // (ADR-045), and notifies the worker (ADR-040 §3: worker relationship to
  // this transition is informational only, not decisional).
  //
  // Disclosed gap (review note, not fixed here): this method is NOT
  // idempotent. Its findFirst() matches status IN
  // (PENDING/ACTIVE/EXTENDED), and per RULE-HR-06/REQ-HR-006 a lapse
  // deliberately does not transition Contract to a fourth "lapsed" state
  // (see the comment inside this method) -- so nothing here prevents a
  // second call against the same still-ACTIVE/EXTENDED contract from
  // re-running deactivateForContractLapse(), writing a second
  // hr_contract.lapse audit entry, and re-notifying the worker.
  // employee-management's own deactivate step is idempotent; this call site
  // is not. Confirmed with the commissioning human: no lapsed_at-style
  // column or EmploymentRecord-status pre-check is being added in this PR --
  // if idempotency is required, it should be solved via an explicit business
  // concept (e.g. a real "lapsed" contract state or equivalent), not an
  // implementation shortcut grafted onto the current state machine. Left as
  // an open decision for a future product/architecture pass.
  async manualLapseContract(
    workerId: string,
    actorId: string,
    actorRole: string
  ): Promise<ContractDto> {
    const contract = await this.prisma.contract.findFirst({
      where: {
        worker_id: workerId,
        status: { in: [ContractStatus.PENDING, ContractStatus.ACTIVE, ContractStatus.EXTENDED] },
      },
      orderBy: { created_at: 'desc' },
    });
    if (!contract) {
      throw new NotFoundError('No lapsable contract found for this worker');
    }

    // RULE-HR-06: lapse offboards, it does not itself transition Contract to
    // a fourth "lapsed" state -- REQ-HR-006 confirms only pending/active/
    // extended/permanent are reachable Contract statuses. The Contract row
    // is left as-is (its own history is preserved); the employment-record
    // deactivation is the actual, observable effect of a lapse.
    await employeeManagementService.deactivateForContractLapse(workerId, 'contract_lapse_manual');

    await this.logAudit(actorId, actorRole, 'hr_contract.lapse', 'Contract', contract.id, {
      worker_id: workerId,
      from_status: contract.status,
    });

    await notificationService.enqueue({
      recipientId: workerId,
      type: 'HR_CONTRACT_LAPSED',
      title: 'Contract lapsed',
      message: 'Your contract has lapsed. Contact your manager for details.',
      data: { contract_id: contract.id },
      transports: [OutboxTransport.PUSH],
      sourceModule: OutboxSourceModule.HR,
      producerService: 'HrService',
    });

    logger.info('hr_contract_lapsed', { contractId: contract.id, workerId, lapsedBy: actorId });

    return this.toDto(contract);
  }

  // ---------------------------------------------------------------------------
  // IF-HR-ContractExpiryReminder (RULE-HR-07, scheduled job)
  // ---------------------------------------------------------------------------
  // Called by HrContractExpiryReminderJob.run() (expiry-reminder-job.ts) on
  // the Platform Worker Scheduler. Notifies the responsible manager (the
  // worker's Hotel Group's Regional Manager -- the identical resolution
  // notifyResponsibleManager()/calendar's notifyManager() already
  // established) at each contract's 1yr/2yr expiry mark. PERMANENT contracts
  // are excluded by construction (expires_at is null, RULE-HR-06) -- "no
  // further reminders once permanent" is satisfied by the query itself, not
  // a separate check.
  //
  // Review fix: notifyResponsibleManagerOfExpiry() (its lookups AND its
  // notificationService.enqueue() call) and the reminder_*_sent_at update
  // below now run inside one this.prisma.$transaction(), with `tx` threaded
  // through to enqueue()'s own optional tx parameter (ADR-029 §2 join --
  // notifications/service.ts:33-39's documented mechanism, not a new one).
  // Previously these were two independent commits: if enqueue() succeeded
  // but the subsequent contract.update() then threw, the notification was
  // already durably queued but the de-dup column was never set, so the next
  // scheduler run would re-send a duplicate reminder for the same mark.
  async sendExpiryReminders(withinMs: number, batchSize: number): Promise<number> {
    const cutoff = new Date(Date.now() + withinMs);
    const now = new Date();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const contracts = await this.prisma.contract.findMany({
      where: {
        status: { in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED] },
        expires_at: { lte: cutoff, not: null },
      },
      take: batchSize,
    });

    let processed = 0;
    for (const contract of contracts) {
      const isExpired = contract.expires_at! <= now;
      const isFirstMark = contract.status === ContractStatus.ACTIVE;

      if (isExpired) {
        // Contract has actually expired! PATH (b) Auto-lapse
        await employeeManagementService.deactivateForContractLapse(contract.worker_id, 'contract_lapse_auto');

        await notificationService.enqueue({
          recipientId: contract.worker_id,
          type: 'HR_CONTRACT_LAPSED',
          title: 'Contract expired',
          message: 'Your contract has expired. Contact your manager for details.',
          data: { contract_id: contract.id },
          transports: [OutboxTransport.PUSH],
          sourceModule: OutboxSourceModule.HR,
          producerService: 'HrService',
        });
        
        logger.info('hr_contract_lapsed_auto', { contractId: contract.id, workerId: contract.worker_id });
        processed++;
        continue;
      }

      // Not expired yet, it's in the warning window
      let needsManagerReminder = false;
      if (isFirstMark && !contract.reminder_1yr_sent_at) needsManagerReminder = true;
      if (!isFirstMark && !contract.reminder_2yr_sent_at) needsManagerReminder = true;

      const needsWorkerReminder = 
        contract.worker_expiry_reminder_count < 7 &&
        (!contract.last_worker_expiry_reminder_at || contract.last_worker_expiry_reminder_at <= twentyFourHoursAgo);

      if (!needsManagerReminder && !needsWorkerReminder) continue;

      await this.prisma.$transaction(async (tx) => {
        if (needsWorkerReminder) {
          await notificationService.enqueue(
            {
              recipientId: contract.worker_id,
              type: 'HR_CONTRACT_EXPIRY_WORKER_REMINDER',
              title: isFirstMark ? 'Your contract is approaching its 1-year mark' : 'Your contract is approaching its 2-year mark',
              message: 'Your contract is about to expire. Please speak with your manager about renewing it soon.',
              data: { worker_id: contract.worker_id, contract_id: contract.id },
              transports: [OutboxTransport.PUSH],
              sourceModule: OutboxSourceModule.HR,
              producerService: 'HrService',
            },
            tx
          );
          await tx.contract.update({
            where: { id: contract.id },
            data: { 
              last_worker_expiry_reminder_at: new Date(),
              worker_expiry_reminder_count: contract.worker_expiry_reminder_count + 1,
            },
          });
        }

        if (needsManagerReminder) {
          const record = await tx.employmentRecord.findUnique({
            where: { user_id: contract.worker_id },
            select: { status: true, hotel_group_id: true },
          });
          if (record && record.status === EmploymentStatus.ACTIVE && record.hotel_group_id) {
            const group = await tx.hotelGroup.findUnique({
              where: { id: record.hotel_group_id },
              select: { regional_manager_user_id: true },
            });
            if (group?.regional_manager_user_id) {
              await notificationService.enqueue(
                {
                  recipientId: group.regional_manager_user_id,
                  type: 'HR_CONTRACT_EXPIRY_REMINDER',
                  title: isFirstMark ? 'Contract approaching 1-year mark' : 'Contract approaching 2-year mark',
                  message: isFirstMark
                    ? 'A contract is approaching its 1-year expiry -- confirm extension or lapse.'
                    : 'A contract is approaching its 2-year mark -- confirm permanence or lapse.',
                  data: { worker_id: contract.worker_id, contract_id: contract.id },
                  transports: [OutboxTransport.PUSH],
                  sourceModule: OutboxSourceModule.HR,
                  producerService: 'HrService',
                },
                tx
              );
            }
          }
          
          await tx.contract.update({
            where: { id: contract.id },
            data: isFirstMark ? { reminder_1yr_sent_at: new Date() } : { reminder_2yr_sent_at: new Date() },
          });
        }
      });
      processed++;
    }

    return processed;
  }

  // ---------------------------------------------------------------------------
  // IF-HR-RequestPayslip (RULE-HR-09, OD-HR-10/ADR-042, EVT-HR-PayslipRequested)
  // ---------------------------------------------------------------------------
  // OD-HR-10 (FIND-SEC-HR-03, IDOR): worker_id MUST be the caller's own
  // identity for a worker-role caller — the controller derives it from
  // req.auth for the worker-self route rather than accepting a client
  // worker_id, mirroring getContractStatus's identical self-scope shape.
  async requestPayslip(data: CreatePayslipRequestRequest): Promise<PayslipRequestDto> {
    const request = await this.prisma.$transaction(async (tx) => {
      const created = await this.createPayslipRequestRecord(data, tx);
      await this.notifyResponsibleManager(data.worker_id, created.id, tx);
      return created;
    });

    logger.info('hr_payslip_requested', { requestId: request.id, workerId: data.worker_id });

    return this.toPayslipDto(request);
  }

  // ---------------------------------------------------------------------------
  // IF-HR-CreatePayroll (ADR-039 target shape: pure payslip-request record,
  // no gross-salary/computation field of any kind — Manager/Admin may also
  // create a request directly on a worker's behalf, per this interface's own
  // actor row, distinct from the worker-self IF-HR-RequestPayslip route).
  //
  // Does NOT call notifyResponsibleManager(): EVT-HR-PayslipRequested's
  // spec-defined trigger (docs/03-modules/hr/MODULE_SPEC.md RULE-HR-09,
  // Events table) is "Worker requests a payslip" specifically — the
  // notification exists so a worker's own submission surfaces to their
  // manager. A manager/admin creating the record already IS the acting
  // manager; there is no "responsible manager" to notify about their own
  // action, and IF-HR-CreatePayroll's interface row lists no notification
  // side-effect at all (unlike IF-HR-ContractExpiryReminder, which explicitly
  // does). Firing it here would be an unrequired, spec-unsupported side effect.
  // ---------------------------------------------------------------------------
  async createPayroll(data: CreatePayslipRequestRequest): Promise<PayslipRequestDto> {
    const request = await this.createPayslipRequestRecord(data);

    logger.info('hr_payroll_created', { requestId: request.id, workerId: data.worker_id });

    return this.toPayslipDto(request);
  }

  private async createPayslipRequestRecord(data: CreatePayslipRequestRequest, tx?: Prisma.TransactionClient) {
    if (!data.worker_id || !data.period_start || !data.period_end) {
      throw new ValidationError('worker_id, period_start, and period_end are required');
    }

    const client = tx || this.prisma;
    
    const workerRecord = await client.employmentRecord.findUnique({
      where: { user_id: data.worker_id },
      select: { start_date: true },
    });
    if (!workerRecord) {
      throw new ValidationError('No employment record found for this worker');
    }

    const periodStart = new Date(`${data.period_start}T00:00:00.000Z`);
    const periodEnd = new Date(`${data.period_end}T00:00:00.000Z`);
    
    // Normalize joining date to midnight UTC for comparison
    const joiningDate = new Date(workerRecord.start_date);
    joiningDate.setUTCHours(0, 0, 0, 0);

    if (periodEnd < periodStart) {
      throw new ValidationError('Payslip request period end cannot be before period start');
    }

    if (periodStart < joiningDate) {
      throw new ValidationError('Payslip request cannot start before the worker joining date');
    }

    // Add a 24-hour buffer to 'today' to accommodate workers in timezones ahead of UTC
    // who might legitimately request a payslip for their 'today' which is 'tomorrow' in UTC.
    const maxAllowedEnd = new Date();
    maxAllowedEnd.setUTCHours(maxAllowedEnd.getUTCHours() + 24);

    if (periodEnd > maxAllowedEnd) {
      throw new ValidationError('Payslip request cannot end in the future');
    }

    return client.payslipRequest.create({
      data: {
        worker_id: data.worker_id,
        period_start: periodStart,
        period_end: periodEnd,
        status: PayslipRequestStatus.REQUESTED,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // IF-HR-ListPayroll (ADR-039/ADR-043: lists PayslipRequest records; scoping
  // — Admin unscoped, Manager via resolveNonAdminScopeFilter (ADR-043), Worker
  // self-scoped via actorId-override IDOR guard below (OD-HR-10/FIND-SEC-HR-03).)
  // ---------------------------------------------------------------------------
  async listPayroll(
    filters: ListPayslipRequestsQuery = {},
    actor?: ServiceActor
  ): Promise<{ data: PayslipRequestDto[]; total: number }> {
    // OD-HR-10 (FIND-SEC-HR-03, IDOR guard): a worker-role caller MUST be
    // scoped to their own PayslipRequest records only — the client-supplied
    // worker_id query param is never trusted for this role. Mirrors
    // getContractStatus's actorId !== workerId → ForbiddenError pattern exactly.
    // Worker callers never reach the resolveNonAdminScopeFilter branch below.
    if (actor?.role === 'worker' || actor?.role === 'checker') {
      if (!actor.userId) throw new ForbiddenError();
      if (filters.worker_id && filters.worker_id !== actor.userId) {
        throw new ForbiddenError();
      }
      // Force the filter regardless of whether the caller supplied worker_id,
      // so an omitted param also returns only the caller's own data.
      filters = { ...filters, worker_id: actor.userId };
    }

    const where: Prisma.PayslipRequestWhereInput = {
      ...(filters.worker_id ? { worker_id: filters.worker_id } : {}),
      ...(filters.status ? { status: filters.status as PayslipRequestStatus } : {}),
    };

    if (actor && actor.role !== 'admin' && actor.role !== 'worker' && actor.role !== 'checker') {
      const scopeFilter = await resolveNonAdminScopeFilter(actor.role, actor.scope ?? null);
      if (scopeFilter.kind === 'deny') {
        where.worker_id = '__none__';
      } else {
        where.worker = { employment_record: { hotel_group_id: scopeFilter.hotelGroupId } };
      }
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const [requests, total] = await Promise.all([
      this.prisma.payslipRequest.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payslipRequest.count({ where }),
    ]);
    return { data: requests.map((r) => this.toPayslipDto(r)), total };
  }


  // ---------------------------------------------------------------------------
  // IF-HR-FulfilPayslipRequest (RULE-HR-09, EVT-HR-PayslipFulfilled)
  // ---------------------------------------------------------------------------
  // OD-HR-13 (hotel-scoping): this route carries no worker_id path param
  // (keyed on the request's own id instead), so checkWorkerScope() cannot
  // gate it at the route layer the way confirmContractSigned's does. Manager
  // scope is instead resolved here — request -> worker_id ->
  // EmploymentRecord.hotel_group_id -> caller's scope, via the same
  // isWorkerInGroupScope() primitive checkWorkerScope() itself calls — so a
  // manager cannot fulfil a payslip request belonging to a worker outside
  // their own hotel group. Admin bypasses (isWorkerInGroupScope's own
  // scope.type === 'global' branch), matching every other HR write's
  // Admin-unscoped behavior.
  //
  // RULE-HR-09: fulfilment is a one-way REQUESTED -> FULFILLED transition.
  // Rejects re-fulfilling an already-FULFILLED request, both to prevent a
  // stale/duplicate manager action from re-notifying the worker and to keep
  // fulfilled_by_id/fulfilled_at as the one true completion record, not
  // silently overwritable by a second caller. This is enforced atomically
  // (see the updateMany() compare-and-swap below), not just by the
  // findUnique()+status-check fast path, which alone would leave a TOCTOU
  // window for two concurrent callers.
  async fulfilPayslipRequest(
    requestId: string,
    actorId: string,
    actorRole: string,
    actorScope?: UserScope | null
  ): Promise<PayslipRequestDto> {
    const request = await this.prisma.payslipRequest.findUnique({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundError('Payslip request not found');
    }

    if (actorRole !== 'admin') {
      const inScope = await isWorkerInGroupScope(actorScope ?? null, request.worker_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot fulfil a payslip request outside your scope');
      }
    }

    if (request.status !== PayslipRequestStatus.REQUESTED) {
      throw new ValidationError('This payslip request has already been fulfilled');
    }

    // Review fix: compare-and-swap via updateMany's WHERE clause (ADR-057's
    // first-accept-wins pattern, job-requests/service.ts:653 -- "the WHERE
    // clause's ... predicate is what Postgres re-evaluates against
    // post-lock values for any concurrent claimant on this same row, making
    // this single UPDATE atomic without a separate version column"). The
    // findUnique+status-check above is a fast-path rejection for the
    // common case; this WHERE clause is what actually prevents two
    // concurrent callers from both fulfilling the same REQUESTED row.
    const claimed = await this.prisma.payslipRequest.updateMany({
      where: { id: requestId, status: PayslipRequestStatus.REQUESTED },
      data: {
        status: PayslipRequestStatus.FULFILLED,
        fulfilled_by_id: actorId,
        fulfilled_at: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new ValidationError('This payslip request has already been fulfilled');
    }

    const updated = await this.prisma.payslipRequest.findUniqueOrThrow({ where: { id: requestId } });

    await notificationService.enqueue({
      recipientId: request.worker_id,
      type: 'HR_PAYSLIP_FULFILLED',
      title: 'Payslip sent',
      message: 'Your requested payslip has been emailed to you.',
      data: { payslip_request_id: requestId },
      transports: [OutboxTransport.PUSH],
      sourceModule: OutboxSourceModule.HR,
      producerService: 'HrService',
    });

    logger.info('hr_payslip_fulfilled', { requestId, fulfilledBy: actorId, actorRole });

    return this.toPayslipDto(updated);
  }

  // Resolves the requesting worker's Hotel Group's Regional Manager as "the
  // responsible manager" — identical pattern to calendar/service.ts's own
  // notifyManager() (EmploymentRecord -> HotelGroup ->
  // regional_manager_user_id). Best-effort: an unassigned/inactive worker
  // has no group and no notification is sent, rather than guessing a
  // fallback recipient (same OD-CAL-06 posture; HR's own equivalent open
  // item is EVT-HR-PayslipRequested's `[OPEN]` transport note, now wired to
  // the existing Outbox/notification-service, matching every other module's
  // transport convention, ADR-032).
  private async notifyResponsibleManager(workerId: string, requestId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx || this.prisma;
    const record = await client.employmentRecord.findUnique({
      where: { user_id: workerId },
      select: { status: true, hotel_group_id: true },
    });
    if (!record || record.status !== EmploymentStatus.ACTIVE || !record.hotel_group_id) return;

    const group = await client.hotelGroup.findUnique({
      where: { id: record.hotel_group_id },
      select: { regional_manager_user_id: true },
    });
    if (!group?.regional_manager_user_id) return;

    await notificationService.enqueue({
      recipientId: group.regional_manager_user_id,
      type: 'HR_PAYSLIP_REQUESTED',
      title: 'Payslip request received',
      message: 'A worker has requested a payslip.',
      data: { worker_id: workerId, payslip_request_id: requestId },
      transports: [OutboxTransport.PUSH, OutboxTransport.EMAIL],
      sourceModule: OutboxSourceModule.HR,
      producerService: 'HrService',
    }, tx);
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
        category: 'CONTRACT_SCAN',
        original_filename: originalFilename,
        mime_type: mimeType,
        file_size_bytes: file.length,
      },
      file,
      actorRole,
      actorIp,
      // Same contract-scan mechanism as uploadContractScan above, same RULE B
      // exemption and same reasoning (documents/service.ts#uploadDocument).
      { systemGenerated: true }
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
    employment_type: EmploymentType;
    scanned_document_id: string | null;
    confirmed_by_id: string | null;
    confirmed_at: Date | null;
    expires_at: Date | null;
    created_at: Date;
    updated_at: Date;
  },
  // Defaults to the stored column so every existing call site keeps its
  // previous meaning; getContractStatus passes the resolved value, which
  // additionally covers the applicant's own upload path.
  signedScanUploaded?: boolean): ContractDto {
    return {
      id: contract.id,
      worker_id: contract.worker_id,
      template_id: contract.template_id,
      position: contract.position,
      start_date: contract.start_date.toISOString().slice(0, 10),
      end_date: contract.end_date ? contract.end_date.toISOString().slice(0, 10) : null,
      status: contract.status as ContractStatusType,
      employment_type: contract.employment_type,
      scanned_document_id: contract.scanned_document_id,
      signed_scan_uploaded: signedScanUploaded ?? contract.scanned_document_id != null,
      confirmed_by_id: contract.confirmed_by_id,
      confirmed_at: contract.confirmed_at ? contract.confirmed_at.toISOString() : null,
      expires_at: contract.expires_at ? contract.expires_at.toISOString() : null,
      // Derived, not stored — see ContractDto's own note on why `status`
      // alone cannot answer this.
      is_valid: isContractValid(contract),
      is_expired: contract.expires_at != null && contract.expires_at <= new Date(),
      created_at: contract.created_at.toISOString(),
      updated_at: contract.updated_at.toISOString(),
    };
  }

  private toPayslipDto(request: {
    id: string;
    worker_id: string;
    period_start: Date;
    period_end: Date;
    status: PayslipRequestStatus;
    fulfilled_by_id: string | null;
    fulfilled_at: Date | null;
    escalated_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }): PayslipRequestDto {
    return {
      id: request.id,
      worker_id: request.worker_id,
      period_start: request.period_start.toISOString().slice(0, 10),
      period_end: request.period_end.toISOString().slice(0, 10),
      status: request.status as PayslipRequestStatusType,
      fulfilled_by_id: request.fulfilled_by_id,
      fulfilled_at: request.fulfilled_at ? request.fulfilled_at.toISOString() : null,
      escalated_at: request.escalated_at ? request.escalated_at.toISOString() : null,
      created_at: request.created_at.toISOString(),
      updated_at: request.updated_at.toISOString(),
    };
  }
}

export const hrService = new HrService();

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
  OutboxTransport,
  OutboxSourceModule,
  Prisma,
} from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import type { DatabaseTransaction } from '../../lib/db.js';
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
  // ADR-043 (OD-HR-13 list-route half): Admin unscoped; Manager's results are
  // server-side filtered to their own hotel_group_id — the identical
  // resolveNonAdminScopeFilter() primitive users/service.ts's listUsers()
  // already established (ADR-030 PR-4, "filter, don't deny"), reused rather
  // than a new mechanism. `actor` is optional so the pre-PR-4 call shape
  // still compiles; the controller always passes it.
  async listContracts(
    filters: ListContractsQuery = {},
    actor?: { role: string; scope?: UserScope | null }
  ): Promise<ContractDto[]> {
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

    const contracts = await this.prisma.contract.findMany({
      where,
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

    const updated = await this.prisma.contract.update({ where: { id: contract.id }, data });

    await this.logAudit(
      actorId,
      actorRole,
      nextStatus === ContractStatus.EXTENDED ? 'hr_contract.extend' : 'hr_contract.make_permanent',
      'Contract',
      contract.id,
      { worker_id: workerId, from_status: contract.status, to_status: nextStatus }
    );

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
    const contracts = await this.prisma.contract.findMany({
      where: {
        status: { in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED] },
        expires_at: { lte: cutoff, not: null },
        OR: [{ reminder_1yr_sent_at: null }, { reminder_2yr_sent_at: null }],
      },
      take: batchSize,
    });

    let sent = 0;
    for (const contract of contracts) {
      // ACTIVE -> approaching the 1yr mark; EXTENDED -> approaching the 2yr
      // (permanence) mark. Each fires at most once per mark (the
      // reminder_*_sent_at columns are the de-duplication guard).
      const isFirstMark = contract.status === ContractStatus.ACTIVE;
      if (isFirstMark && contract.reminder_1yr_sent_at) continue;
      if (!isFirstMark && contract.reminder_2yr_sent_at) continue;

      await this.prisma.$transaction(async (tx) => {
        await this.notifyResponsibleManagerOfExpiry(contract.worker_id, contract.id, isFirstMark, tx);

        await tx.contract.update({
          where: { id: contract.id },
          data: isFirstMark ? { reminder_1yr_sent_at: new Date() } : { reminder_2yr_sent_at: new Date() },
        });
      });
      sent++;
    }

    return sent;
  }

  private async notifyResponsibleManagerOfExpiry(
    workerId: string,
    contractId: string,
    isFirstMark: boolean,
    tx: DatabaseTransaction
  ): Promise<void> {
    const record = await tx.employmentRecord.findUnique({
      where: { user_id: workerId },
      select: { status: true, hotel_group_id: true },
    });
    if (!record || record.status !== EmploymentStatus.ACTIVE || !record.hotel_group_id) return;

    const group = await tx.hotelGroup.findUnique({
      where: { id: record.hotel_group_id },
      select: { regional_manager_user_id: true },
    });
    if (!group?.regional_manager_user_id) return;

    await notificationService.enqueue(
      {
        recipientId: group.regional_manager_user_id,
        type: 'HR_CONTRACT_EXPIRY_REMINDER',
        title: isFirstMark ? 'Contract approaching 1-year mark' : 'Contract approaching 2-year mark',
        message: isFirstMark
          ? 'A contract is approaching its 1-year expiry -- confirm extension or lapse.'
          : 'A contract is approaching its 2-year mark -- confirm permanence or lapse.',
        data: { worker_id: workerId, contract_id: contractId },
        transports: [OutboxTransport.PUSH],
        sourceModule: OutboxSourceModule.HR,
        producerService: 'HrService',
      },
      tx
    );
  }

  // ---------------------------------------------------------------------------
  // IF-HR-RequestPayslip (RULE-HR-09, OD-HR-10/ADR-042, EVT-HR-PayslipRequested)
  // ---------------------------------------------------------------------------
  // OD-HR-10 (FIND-SEC-HR-03, IDOR): worker_id MUST be the caller's own
  // identity for a worker-role caller — the controller derives it from
  // req.auth for the worker-self route rather than accepting a client
  // worker_id, mirroring getContractStatus's identical self-scope shape.
  async requestPayslip(data: CreatePayslipRequestRequest): Promise<PayslipRequestDto> {
    const request = await this.createPayslipRequestRecord(data);

    await this.notifyResponsibleManager(data.worker_id, request.id);

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

  private async createPayslipRequestRecord(data: CreatePayslipRequestRequest) {
    if (!data.worker_id || !data.period_start || !data.period_end) {
      throw new ValidationError('worker_id, period_start, and period_end are required');
    }

    return this.prisma.payslipRequest.create({
      data: {
        worker_id: data.worker_id,
        period_start: new Date(`${data.period_start}T00:00:00.000Z`),
        period_end: new Date(`${data.period_end}T00:00:00.000Z`),
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
  ): Promise<PayslipRequestDto[]> {
    // OD-HR-10 (FIND-SEC-HR-03, IDOR guard): a worker-role caller MUST be
    // scoped to their own PayslipRequest records only — the client-supplied
    // worker_id query param is never trusted for this role. Mirrors
    // getContractStatus's actorId !== workerId → ForbiddenError pattern exactly.
    // Worker callers never reach the resolveNonAdminScopeFilter branch below.
    if (actor?.role === 'worker') {
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

    if (actor && actor.role !== 'admin' && actor.role !== 'worker') {
      const scopeFilter = await resolveNonAdminScopeFilter(actor.role, actor.scope ?? null);
      if (scopeFilter.kind === 'deny') {
        where.worker_id = '__none__';
      } else {
        where.worker = { employment_record: { hotel_group_id: scopeFilter.hotelGroupId } };
      }
    }

    const requests = await this.prisma.payslipRequest.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
    return requests.map((r) => this.toPayslipDto(r));
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
  private async notifyResponsibleManager(workerId: string, requestId: string): Promise<void> {
    const record = await this.prisma.employmentRecord.findUnique({
      where: { user_id: workerId },
      select: { status: true, hotel_group_id: true },
    });
    if (!record || record.status !== EmploymentStatus.ACTIVE || !record.hotel_group_id) return;

    const group = await this.prisma.hotelGroup.findUnique({
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
      transports: [OutboxTransport.PUSH],
      sourceModule: OutboxSourceModule.HR,
      producerService: 'HrService',
    });
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

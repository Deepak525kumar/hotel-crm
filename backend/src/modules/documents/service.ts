// SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16 Decided 2026-07-27).
// Implements: IF-DOC-UploadDocument, IF-DOC-GetDocumentCompleteness,
//             IF-DOC-GetDocument, IF-DOC-ListWorkerDocuments,
//             IF-DOC-ExportWorkerDocuments (all from the spec Interfaces table).
//
// Ownership boundary: this service ONLY writes WorkerDocument rows and its
// own AuditLog entries (via BaseService.logAudit). It never writes:
//   - Contract / HR state (backend-hr, ADR-012)
//   - User/HotelWorker/employment-status (SPEC-EMP-001)
//   - Personalfragebogen / consent / retention-sweep (respective modules)
//
// GD-16 authorised actors: self-upload (worker) + manager-upload only.
// Group-scoped read for GET /documents/:document_id is enforced HERE, in
// getDocument() (isWorkerInGroupScope) -- corrected 2026-08-08: this comment
// previously claimed routes.ts's checkHotelAccess() gated it, but that route
// has no scope middleware at all (FIND-SEC-DOC-01's own routes.ts comment
// says the same; neither was true until this fix).

import { DocumentCategory, Prisma } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { generateStorageKey, getStorageClient } from './storage.js';
// ADR-066 (Option A): shared malware-scan seam. Owned by backend-hr today
// (ADR-044 was its first consumer); imported cross-module here rather than
// relocated -- see ADR-066 §5's implementation note.
import { getMalwareScanner } from '../hr/malware-scan.js';
import { isWorkerInGroupScope } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import type {
  WorkerDocumentDto,
  DocumentCompleteness,
  UploadDocumentInput,
  DocumentCategoryType,
} from './types.js';

// The set of MIME types and max size are validated by the controller (via
// validation.ts) before the service is called. The service re-asserts the
// file size bound as a defence-in-depth guard (RULE-DOC-09).
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export class DocumentService extends BaseService {
  // ---------------------------------------------------------------------------
  // IF-DOC-UploadDocument
  // ---------------------------------------------------------------------------
  // GD-16: self-upload (worker) or manager-upload (contract-scan mechanism).
  // RULE-DOC-08: actor_id is always from req.auth, never a client body field.
  // RULE-DOC-09: storage key is server-generated with a UUIDv4 component.
  // REQ-DOC-007: all bytes stored in S3 (EU).
  async uploadDocument(
    input: UploadDocumentInput,
    fileBuffer: Buffer,
    actorRole: string,
    actorIp?: string,
    opts: { systemGenerated?: boolean } = {}
  ): Promise<WorkerDocumentDto> {
    // RULE-DOC-09 defence-in-depth: the controller validates via Zod, but the
    // service also enforces the size bound in case it's called directly.
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(`File size exceeds the maximum of ${MAX_FILE_SIZE_BYTES} bytes`);
    }

    // RULE B (project-owner decision, 2026-08-12): NOBODY may perform another
    // user's onboarding. Document upload on the ONBOARDING path is
    // SELF-SERVICE ONLY, for EVERY role including admin.
    //
    // This REPLACES the previous guard, which was scoped to `actorRole ===
    // 'worker'` and therefore let admin/manager/regional_manager upload into
    // any worker's document set. That was the bypass the owner closed: it
    // REVERSES GD-16's "manager-upload" allowance and the 2026-08-04
    // Regional-Manager widening recorded in routes.ts's governance note.
    //
    // The check is role-independent by construction — there is no role branch
    // to forget to extend when a role is added, and no early-return above it
    // for a privileged role (the ordering mistake that made the same bypass
    // possible in employee-management's assertLifecycleAuthority).
    //
    // `systemGenerated` is the ONLY exemption, and it is not reachable from
    // any HTTP request: `documentController.uploadDocument` never sets it, and
    // the sole route that reaches this method (POST
    // /documents/workers/:worker_id/documents) additionally enforces the same
    // self-check in its own middleware (requireSelfWorker, routes.ts). It
    // exists for three IN-PROCESS callers that generate a document ABOUT a
    // worker rather than performing that worker's onboarding, and which
    // therefore fall outside RULE B's subject matter entirely:
    //
    //   - hr/service.ts uploadContractScan  — the scanned SIGNED CONTRACT,
    //     produced by the counterparty after the applicant already onboarded.
    //   - hr/service.ts uploadDocument      — same contract-scan mechanism
    //     (ADR-044 / MIG-GAP-DOC-001 delegation).
    //
    // (A third caller, document-templates/service.ts, existed 2026-08-09
    // through 2026-08-13 -- removed by product decision, superseded by
    // backend-hr's Contract feature. Its authorization pattern, noted here
    // for history: assertInstanceFillAccess before delegating.)
    //
    // Each of those callers performs its OWN authorization before delegating
    // (contract ownership check). Do not add another caller without an
    // equivalent check, and never plumb this flag to a
    // request-controlled value — it would reopen the exact bypass above.
    if (!opts.systemGenerated && input.actor_id !== input.worker_id) {
      throw new ForbiddenError(
        'Documents may only be uploaded by the worker they belong to; no role may upload on another user\'s behalf'
      );
    }
    // `actorRole` is still recorded in the audit entry below, but no longer
    // participates in the upload authorization decision.

    const category = input.category as DocumentCategory;

    // OD-DOC-016/ADR-066 (Option A, ratified 2026-08-12): synchronous
    // malware-scan hook, before the file is persisted anywhere (S3 or DB) --
    // mirroring ADR-044's Decisions 1-2 for the mechanism-class-identical HR
    // contract-scan path (hr/service.ts). Reject on detection.
    //
    // The seam is imported from backend-hr rather than relocated to lib/:
    // hr/malware-scan.ts is a leaf module with no imports of its own, so this
    // introduces no import cycle despite the pre-existing hr -> documents
    // module direction. See ADR-066 §5's implementation note for why
    // relocation was considered and deliberately deferred.
    //
    // NOTE: the default scanner is a PASS-THROUGH NO-OP (hr/malware-scan.ts's
    // noOpScanner) -- no vendor/library has been selected by ADR-044 or
    // ADR-066. This is real control flow, not real detection. Do not read the
    // presence of this call as evidence that uploads are scanned.
    const scanResult = await getMalwareScanner().scan(fileBuffer);
    if (!scanResult.clean) {
      throw new ValidationError(
        `Uploaded file failed the malware scan${scanResult.reason ? `: ${scanResult.reason}` : ''}`
      );
    }

    // RULE-DOC-09: server-generated key, never from client input.
    const s3Key = generateStorageKey(input.worker_id, category, input.original_filename);

    // Store bytes in S3 (EU). If S3_BUCKET is not configured, the stub no-ops
    // and the metadata row is still persisted (development / test posture).
    const storage = await getStorageClient();
    try {
      await storage.upload(s3Key, fileBuffer, input.mime_type);
    } catch (err) {
      logger.error('documents_s3_upload_failed', { workerId: input.worker_id, error: err });
      throw err;
    }

    const expiresAt = input.expires_at ? new Date(`${input.expires_at}T00:00:00.000Z`) : null;

    let doc;
    try {
      doc = await this.prisma.$transaction(async (tx) => {
        const createdDoc = await tx.workerDocument.create({
          data: {
            worker_id: input.worker_id,
            uploaded_by_id: input.actor_id,
            category,
            s3_key: s3Key,
            original_filename: input.original_filename,
            mime_type: input.mime_type,
            file_size_bytes: fileBuffer.length,
            expires_at: expiresAt,
            is_work_permit: input.is_work_permit ?? false,
          },
        });

        await this.logAudit(
          input.actor_id,
          actorRole,
          'document.upload',
          'WorkerDocument',
          createdDoc.id,
          {
            worker_id: input.worker_id,
            category,
            original_filename: input.original_filename,
            is_work_permit: createdDoc.is_work_permit,
          },
          actorIp,
          undefined,
          undefined,
          tx
        );

        return createdDoc;
      });
    } catch (err) {
      // Compensating action: delete the orphaned S3 object if the DB transaction fails
      try {
        await storage.delete(s3Key);
      } catch (deleteErr) {
        logger.error('documents_s3_compensating_delete_failed', { s3Key, error: deleteErr });
      }
      throw err;
    }

    const presignedUrl = await storage.getPresignedUrl(s3Key).catch(() => null);
    return this.toDto(doc, presignedUrl);
  }

  // ---------------------------------------------------------------------------
  // IF-DOC-ListWorkerDocuments
  // ---------------------------------------------------------------------------
  // GD-16: hotel-scoped read enforced by checkHotelAccess() in routes.
  // FIND-SEC-DOC-01: worker_id is bound to the authenticated caller's own
  // identity for WORKER-role callers (enforced here; manager/RM pass through
  // the hotel-scope check in routes).
  async listWorkerDocuments(
    workerId: string,
    actorId: string,
    actorRole: string,
    categoryFilter?: DocumentCategoryType
  ): Promise<WorkerDocumentDto[]> {
    if ((actorRole === 'worker' || actorRole === 'checker') && actorId !== workerId) {
      throw new ForbiddenError('Workers may only view their own documents');
    }

    const where: Prisma.WorkerDocumentWhereInput = {
      worker_id: workerId,
      ...(categoryFilter ? { category: categoryFilter as DocumentCategory } : {}),
    };

    const docs = await this.prisma.workerDocument.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    const storage = await getStorageClient();
    return Promise.all(
      docs.map(async (doc) => {
        const url = await storage.getPresignedUrl(doc.s3_key).catch(() => null);
        return this.toDto(doc, url);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // IF-DOC-GetDocument
  // ---------------------------------------------------------------------------
  // FIND-SEC-DOC-01: bare document id lookup MUST bind to owner or management
  // chain before returning. Worker-role: own document only. Manager/RM: via
  // hotel scope (enforced by checkHotelAccess() in routes, which gates the
  // route before this service method is called).
  async getDocument(
    documentId: string,
    actorId: string,
    actorRole: string,
    actorScope?: UserScope | null
  ): Promise<WorkerDocumentDto> {
    const doc = await this.prisma.workerDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundError('Document not found');

    // WORKER can only access their own document.
    if ((actorRole === 'worker' || actorRole === 'checker') && doc.worker_id !== actorId) {
      throw new ForbiddenError('Workers may only access their own documents');
    } else if (actorRole === 'manager' || actorRole === 'regional_manager') {
      // IDOR fix (2026-08-08): routes.ts has no checkHotelAccess()/
      // checkWorkerScope() on this route at all -- FIND-SEC-DOC-01's own
      // comment there says ownership binding is enforced HERE, in the
      // service, but this branch never existed. A manager/RM fell through
      // both checks entirely and could download any document platform-wide
      // by id. Reuses isWorkerInGroupScope (documents are group-grain, same
      // as the worker's own EmploymentRecord.hotel_group_id, not
      // hotel-grain -- there is no hotel_id on WorkerDocument itself).
      const inScope = await isWorkerInGroupScope(actorScope ?? null, doc.worker_id);
      if (!inScope) {
        throw new ForbiddenError('Cannot access this document');
      }
    }

    const storage = await getStorageClient();
    const url = await storage.getPresignedUrl(doc.s3_key).catch(() => null);
    return this.toDto(doc, url);
  }

  // ---------------------------------------------------------------------------
  // IF-DOC-DeleteDocument (2026-08-13: worker edit/replace fix)
  // ---------------------------------------------------------------------------
  // The reviewer's "view documents" checklist issue surfaced a real gap on
  // the other side of the same feature: there was no way for a worker to
  // correct a wrong upload (wrong file, wrong category) short of it staying
  // in their document set forever, since re-uploading the same category
  // creates a SECOND row rather than replacing the first (no unique
  // constraint on (worker_id, category) -- schema.prisma's own comment on
  // WorkerDocument). "Edit" for an immutable-file-object model means
  // delete-then-reupload, not in-place mutation of the stored bytes.
  //
  // Self-only, mirroring uploadDocument's RULE B posture exactly: a worker
  // may delete only their OWN document, and no other role may delete a
  // worker's document on their behalf (reviewers are explicitly view-only --
  // this module's role gates already enforce that by simply not granting
  // manager/RM/admin any write route here at all).
  async deleteDocument(documentId: string, actorId: string, actorRole: string): Promise<void> {
    const doc = await this.prisma.workerDocument.findUnique({
      where: { id: documentId },
      include: { hr_contract_scan: { select: { id: true } } },
    });
    if (!doc) throw new NotFoundError('Document not found');

    if ((actorRole !== 'worker' && actorRole !== 'checker') || doc.worker_id !== actorId) {
      throw new ForbiddenError('Documents may only be deleted by the worker they belong to');
    }

    // A document already attached to a contract as its signed scan is no
    // longer "just an onboarding upload" -- it is HR's compensating-control
    // evidence trail (RULE-HR-15). Deleting it here would silently orphan
    // Contract.scanned_document_id and destroy that evidence; the worker
    // must go through HR's own contract flow (a fresh scan upload) instead.
    if (doc.hr_contract_scan) {
      throw new ForbiddenError('Cannot delete a document that has been submitted as a signed contract scan');
    }

    // REVIEW LOCK (2026-08-13, onboarding audit finding #1). Without this, a
    // worker could submit a COMPLETE application, then delete mandatory
    // documents while it sat in the reviewer's queue -- leaving the reviewer
    // looking at a "submitted" application that is silently missing legally
    // required files. Reproduced end-to-end before fixing: submit succeeded,
    // PASSPORT was deleted, and completeness flipped to is_complete=false
    // while the record stayed in the queue as submitted.
    //
    // Keyed on submitted_for_review_at (the PENDING sub-state that means
    // "awaiting a decision"), not on status: status stays PENDING across both
    // the pre-submit and awaiting-review phases, so it cannot distinguish
    // them. Once a decision is made the record leaves this state -- approved
    // (ACTIVE) or rejected (REJECTED, which clears nothing but is no longer
    // awaiting review) -- and editing is possible again, which is the point:
    // a rejected applicant must be able to replace the document that was
    // wrong.
    const record = await this.prisma.employmentRecord.findUnique({
      where: { user_id: doc.worker_id },
      select: { status: true, submitted_for_review_at: true },
    });
    // The ONLY window in which a worker may delete their own documents is
    // while they are still assembling an application nobody has acted on:
    // PENDING and not yet submitted, or REJECTED (where the whole point is to
    // replace the document that was wrong and try again).
    //
    // Everything else is locked, and the ACTIVE case is the important one: an
    // employed worker deleting their Passport / Tax Number / Health Insurance
    // destroys records the company is legally required to retain. An earlier
    // version of this guard checked only `status === 'PENDING' &&
    // submitted_for_review_at`, which disengaged the moment someone was hired
    // -- narrower than the compliance requirement it was meant to serve.
    // Expressed as an allow-list so a newly-added status is locked by default
    // rather than silently permitted.
    const canEditOwnDocuments =
      !record ||
      record.status === 'REJECTED' ||
      (record.status === 'PENDING' && !record.submitted_for_review_at);

    if (!canEditOwnDocuments) {
      throw new ForbiddenError(
        record?.status === 'PENDING'
          ? 'Cannot delete documents while your application is under review. Contact your manager if a document needs to be replaced.'
          : 'Cannot delete documents that form part of your employment record. Contact your manager if a document needs to be replaced.'
      );
    }

    const storage = await getStorageClient();
    await this.prisma.$transaction(async (tx) => {
      await tx.workerDocument.delete({ where: { id: documentId } });
      await this.logAudit(
        actorId,
        actorRole,
        'document.delete',
        'WorkerDocument',
        documentId,
        { worker_id: doc.worker_id, category: doc.category, original_filename: doc.original_filename },
        undefined,
        undefined,
        undefined,
        tx
      );
    });

    try {
      await storage.delete(doc.s3_key);
    } catch (err) {
      // Best-effort: the DB row is already gone (the delete is the
      // authoritative, user-visible action) -- an S3 cleanup failure here
      // leaves an orphaned object, not an orphaned/inconsistent document
      // list. Logged, not thrown, mirroring uploadDocument's own
      // compensating-delete error handling above (that path logs+rethrows
      // because ITS failure leaves the DB row missing something real; this
      // one doesn't).
      logger.error('documents_s3_delete_failed', { s3Key: doc.s3_key, error: err });
    }
  }

  // ---------------------------------------------------------------------------
  // IF-DOC-GetDocumentCompleteness (REQ-DOC-002/REQ-DOC-005)
  // ---------------------------------------------------------------------------
  // Onboarding and Employee Management call this to determine whether a worker
  // has uploaded all required documents. This module exposes the fact; the
  // caller (Onboarding) drives the activation write and re-prompt (RULE-DOC-02).
  //
  // is_work_permit_required must be supplied by the caller (derived from the
  // worker's Personalfragebogen nationality field, owned by Onboarding —
  // RULE-DOC-03; Documents does not own nationality).
  async getDocumentCompleteness(
    workerId: string,
    isWorkPermitRequired: boolean,
    actorId?: string,
    actorRole?: string
  ): Promise<DocumentCompleteness> {
    if ((actorRole === 'worker' || actorRole === 'checker') && actorId !== workerId) {
      throw new ForbiddenError('Workers may only view their own documents');
    }

    const docs = await this.prisma.workerDocument.findMany({
      where: { worker_id: workerId },
      select: { category: true },
    });

    const hasCat = (cat: DocumentCategory) => docs.some((d) => d.category === cat);

    const categories: Record<DocumentCategoryType, boolean> = {
      TAX_NUMBER: hasCat(DocumentCategory.TAX_NUMBER),
      SOCIAL_SECURITY_NUMBER: hasCat(DocumentCategory.SOCIAL_SECURITY_NUMBER),
      HEALTH_INSURANCE: hasCat(DocumentCategory.HEALTH_INSURANCE),
      ID_CARD: hasCat(DocumentCategory.ID_CARD),
      PASSPORT: hasCat(DocumentCategory.PASSPORT),
      ADDRESS: hasCat(DocumentCategory.ADDRESS),
      WORK_PERMIT: hasCat(DocumentCategory.WORK_PERMIT),
      // Reported for visibility, but deliberately absent from `missing`
      // below: the contract has its own, stricter gate
      // (assertApprovedContract requires a manager-CONFIRMED contract, not
      // merely an uploaded file), so counting it here would double-gate it
      // and let an unconfirmed upload satisfy the document checklist.
      CONTRACT_SCAN: hasCat(DocumentCategory.CONTRACT_SCAN),
    };

    const missing: DocumentCategoryType[] = [];
    if (!categories.TAX_NUMBER) missing.push('TAX_NUMBER');
    if (!categories.SOCIAL_SECURITY_NUMBER) missing.push('SOCIAL_SECURITY_NUMBER');
    if (!categories.HEALTH_INSURANCE) missing.push('HEALTH_INSURANCE');
    if (!categories.ID_CARD && !categories.PASSPORT) {
      missing.push('ID_CARD');
      missing.push('PASSPORT');
    }
    if (!categories.ADDRESS) missing.push('ADDRESS');
    if (isWorkPermitRequired && !categories.WORK_PERMIT) missing.push('WORK_PERMIT');

    return {
      worker_id: workerId,
      work_permit_required: isWorkPermitRequired,
      is_complete: missing.length === 0,
      missing_categories: missing,
      categories,
      document_count: docs.length,
    };
  }

  // ---------------------------------------------------------------------------
  // IF-DOC-ExportWorkerDocuments (REQ-DOC-015, subject-rights support)
  // ---------------------------------------------------------------------------
  // RULE-DOC-10: Documents exposes retrievability of a worker's own records;
  // fulfilment orchestration (assembling the full subject-rights response,
  // delivering it) is Compliance's responsibility (OD-DOC-012).
  // FIND-SEC-DOC-01: scoped strictly to one worker's own records.
  async exportWorkerDocuments(
    workerId: string,
    actorId: string,
    actorRole: string
  ): Promise<WorkerDocumentDto[]> {
    // Self-scoped for worker role; Compliance/Admin calls pass through.
    if ((actorRole === 'worker' || actorRole === 'checker') && actorId !== workerId) {
      throw new ForbiddenError('Workers may only export their own documents');
    }

    const docs = await this.prisma.workerDocument.findMany({
      where: { worker_id: workerId },
      orderBy: { created_at: 'asc' },
    });

    const storage = await getStorageClient();
    return Promise.all(
      docs.map(async (doc) => {
        const url = await storage.getPresignedUrl(doc.s3_key).catch(() => null);
        return this.toDto(doc, url);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  private toDto(
    doc: {
      id: string;
      worker_id: string;
      uploaded_by_id: string;
      category: DocumentCategory;
      s3_key: string;
      original_filename: string;
      mime_type: string;
      file_size_bytes: number;
      expires_at: Date | null;
      is_work_permit: boolean;
      created_at: Date;
      updated_at: Date;
    },
    presignedUrl: string | null
  ): WorkerDocumentDto {
    return {
      id: doc.id,
      worker_id: doc.worker_id,
      uploaded_by_id: doc.uploaded_by_id,
      category: doc.category as DocumentCategoryType,
      // s3_key is NOT included in the DTO (OD-DOC-017: bucket-exposure posture).
      presigned_url: presignedUrl,
      original_filename: doc.original_filename,
      mime_type: doc.mime_type,
      file_size_bytes: doc.file_size_bytes,
      expires_at: doc.expires_at ? doc.expires_at.toISOString().slice(0, 10) : null,
      is_work_permit: doc.is_work_permit,
      created_at: doc.created_at.toISOString(),
      updated_at: doc.updated_at.toISOString(),
    };
  }
}

export const documentService = new DocumentService();

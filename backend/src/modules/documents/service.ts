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
// Hotel-scoped read is enforced in routes.ts via checkHotelAccess().

import { DocumentCategory, Prisma } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { generateStorageKey, getStorageClient } from './storage.js';
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
    actorIp?: string
  ): Promise<WorkerDocumentDto> {
    // RULE-DOC-09 defence-in-depth: the controller validates via Zod, but the
    // service also enforces the size bound in case it's called directly.
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(`File size exceeds the maximum of ${MAX_FILE_SIZE_BYTES} bytes`);
    }

    // GD-16: worker may only upload to their own document set (self-scoped).
    // Managers may upload on behalf of any worker in their hotel (the hotel
    // scope check is enforced by checkHotelAccess() in routes.ts before this
    // is reached). Here we enforce that a WORKER role cannot upload for another
    // worker.
    if (
      actorRole === 'worker' &&
      input.actor_id !== input.worker_id
    ) {
      throw new ForbiddenError('Workers may only upload documents to their own document set');
    }

    const category = input.category as DocumentCategory;

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

    const doc = await this.prisma.workerDocument.create({
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
      doc.id,
      {
        worker_id: input.worker_id,
        category,
        original_filename: input.original_filename,
        is_work_permit: doc.is_work_permit,
      },
      actorIp
    );

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
    if (actorRole === 'worker' && actorId !== workerId) {
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
    actorRole: string
  ): Promise<WorkerDocumentDto> {
    const doc = await this.prisma.workerDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundError('Document not found');

    // WORKER can only access their own document.
    if (actorRole === 'worker' && doc.worker_id !== actorId) {
      throw new ForbiddenError('Workers may only access their own documents');
    }

    const storage = await getStorageClient();
    const url = await storage.getPresignedUrl(doc.s3_key).catch(() => null);
    return this.toDto(doc, url);
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
    isWorkPermitRequired: boolean
  ): Promise<DocumentCompleteness> {
    const docs = await this.prisma.workerDocument.findMany({
      where: { worker_id: workerId },
      select: { category: true },
    });

    const hasGeneral = docs.some((d) => d.category === DocumentCategory.GENERAL);
    const hasWorkPermit = docs.some((d) => d.category === DocumentCategory.WORK_PERMIT);

    const missing: DocumentCategoryType[] = [];
    if (!hasGeneral) missing.push('GENERAL');
    if (isWorkPermitRequired && !hasWorkPermit) missing.push('WORK_PERMIT');

    return {
      worker_id: workerId,
      work_permit_required: isWorkPermitRequired,
      is_complete: missing.length === 0,
      missing_categories: missing,
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
    if (actorRole === 'worker' && actorId !== workerId) {
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

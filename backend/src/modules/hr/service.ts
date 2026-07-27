import { BaseService } from '../../lib/base-service.js';
import { NotImplementedError } from '../../lib/errors.js';
import { documentService } from '../documents/service.js';

export class HrService extends BaseService {
  async createContract(_data: Record<string, unknown>) {
    throw new NotImplementedError('HR contracts are not yet implemented');
  }

  async listContracts(_filters?: Record<string, unknown>) {
    throw new NotImplementedError('HR contracts are not yet implemented');
  }

  async createPayroll(_data: Record<string, unknown>) {
    throw new NotImplementedError('HR payroll is not yet implemented');
  }

  async listPayroll(_filters?: Record<string, unknown>) {
    throw new NotImplementedError('HR payroll is not yet implemented');
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
}

export const hrService = new HrService();

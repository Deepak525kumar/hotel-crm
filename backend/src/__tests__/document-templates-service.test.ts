import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Document Templates module (2026-08-09, greenfield). Pins:
 *  - fork-on-edit (DRAFT editable in place, PUBLISHED forks on structural edit)
 *  - shared_key propagation across sections of the same template
 *  - no-proxy-fill / signer_role RBAC (worker=SUBJECT-only, manager/admin=COUNTERSIGNER-only)
 *  - service-layer group-scope IDOR enforcement, mirroring documents/service.ts#getDocument's fix
 *  - finalize() rejects with unsigned required blocks
 */

const mockTemplateCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockTemplateFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockTemplateFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockTemplateUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockSectionCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockSectionUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockFieldCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockFieldUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockSignatureBlockCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockInstanceCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockInstanceFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockInstanceFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockInstanceCount = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockInstanceUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockFieldValueUpsert = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockSignatureBlockFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockInstanceSignatureCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockTransaction = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    documentTemplate: {
      create: mockTemplateCreate,
      findMany: mockTemplateFindMany,
      findUnique: mockTemplateFindUnique,
      update: mockTemplateUpdate,
    },
    documentTemplateSection: { create: mockSectionCreate, update: mockSectionUpdate },
    documentTemplateField: { create: mockFieldCreate, update: mockFieldUpdate },
    documentTemplateSignatureBlock: {
      create: mockSignatureBlockCreate,
      findUnique: mockSignatureBlockFindUnique,
    },
    documentInstance: {
      create: mockInstanceCreate,
      findUnique: mockInstanceFindUnique,
      findMany: mockInstanceFindMany,
      count: mockInstanceCount,
      update: mockInstanceUpdate,
    },
    documentInstanceFieldValue: { upsert: mockFieldValueUpsert },
    documentInstanceSignature: { create: mockInstanceSignatureCreate },
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
    hotel: { findUnique: mockHotelFindUnique },
    auditLog: { create: mockAuditLogCreate },
    $transaction: mockTransaction,
  }),
}));

jest.mock('../modules/documents/storage.js', () => ({
  generateStorageKey: (workerId: string, category: string, filename: string) =>
    `documents/${workerId}/${category.toLowerCase()}/test-uuid/${filename}`,
  getStorageClient: async () => ({
    upload: jest.fn(),
    getPresignedUrl: async () => 'https://example.test/presigned',
    delete: jest.fn(),
  }),
}));

const mockUploadDocument = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockGetDocument = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
jest.mock('../modules/documents/service.js', () => ({
  documentService: { uploadDocument: mockUploadDocument, getDocument: mockGetDocument },
}));

const mockScan = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
jest.mock('../modules/hr/malware-scan.js', () => ({
  getMalwareScanner: () => ({ scan: mockScan }),
}));

jest.mock('../modules/document-templates/pdf-renderer.js', () => ({
  renderInstanceToPdf: jest.fn(async () => Buffer.from('pdf')),
  renderSectionHtml: jest.fn(async (section: any) => `<section>${section.id}</section>`),
}));

import { DocumentTemplatesService } from '../modules/document-templates/service.js';
import { ConflictError, ForbiddenError, ValidationError } from '../lib/errors.js';

function baseTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'Arbeitsvertrag',
    description: null,
    status: 'DRAFT',
    version: 1,
    parent_template_id: null,
    created_by_id: 'admin1',
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    published_at: null,
    archived_at: null,
    sections: [],
    ...overrides,
  };
}

describe('DocumentTemplatesService', () => {
  let service: DocumentTemplatesService;

  beforeEach(() => {
    service = new DocumentTemplatesService();
    for (const m of [
      mockTemplateCreate,
      mockTemplateFindMany,
      mockTemplateFindUnique,
      mockTemplateUpdate,
      mockSectionCreate,
      mockSectionUpdate,
      mockFieldCreate,
      mockFieldUpdate,
      mockSignatureBlockCreate,
      mockInstanceCreate,
      mockInstanceFindUnique,
      mockInstanceFindMany,
      mockInstanceCount,
      mockInstanceUpdate,
      mockFieldValueUpsert,
      mockSignatureBlockFindUnique,
      mockInstanceSignatureCreate,
      mockAuditLogCreate,
      mockEmploymentRecordFindUnique,
      mockHotelFindUnique,
      mockTransaction,
      mockUploadDocument,
      mockGetDocument,
      mockScan,
    ]) {
      m.mockReset();
    }
    mockTransaction.mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg({
          documentTemplate: { create: mockTemplateCreate },
          documentTemplateSection: {
            create: (async (...args: any[]) => {
              const result = await mockSectionCreate(...args);
              return result ?? { id: 's-fork-1' };
            }) as any,
          },
          documentTemplateField: { create: mockFieldCreate },
          documentTemplateSignatureBlock: { create: mockSignatureBlockCreate },
        });
      }
      return Promise.all(arg);
    });
    mockScan.mockResolvedValue({ clean: true });
  });

  describe('fork-on-edit', () => {
    it('edits a DRAFT template in place (no fork)', async () => {
      mockTemplateFindUnique.mockResolvedValue(baseTemplate());
      mockTemplateUpdate.mockResolvedValue(baseTemplate({ name: 'Renamed' }));

      await service.updateTemplate('t1', { name: 'Renamed' }, { userId: 'admin1', role: 'admin' });

      expect(mockTemplateCreate).not.toHaveBeenCalled();
      expect(mockTemplateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1' } })
      );
    });

    it('forks a PUBLISHED template into a new DRAFT version on structural edit', async () => {
      const published = baseTemplate({
        status: 'PUBLISHED',
        sections: [
          {
            id: 's1',
            title: 'Section 1',
            order_index: 0,
            body_template: 'Hello {{employee_name}}',
            fields: [
              {
                id: 'f1',
                field_key: 'employee_name',
                label: 'Employee name',
                field_type: 'TEXT',
                is_required: true,
                order_index: 0,
                shared_key: 'employee_name',
                select_options: null,
                validation: null,
                help_text: null,
              },
            ],
            signature_blocks: [
              { id: 'b1', label: 'Employee signature', signer_role: 'SUBJECT', order_index: 0 },
            ],
          },
        ],
      });
      const fork = baseTemplate({ id: 't2', status: 'DRAFT', version: 2, parent_template_id: 't1' });

      mockTemplateFindUnique
        .mockResolvedValueOnce(published) // loadTemplateWithSections inside resolveEditableTemplate
        .mockResolvedValueOnce(fork) // loadTemplateWithSections(fork) at the end of resolveEditableTemplate
        .mockResolvedValueOnce(fork); // getTemplate() at the end of updateTemplate
      mockTemplateCreate.mockResolvedValue({ id: 't2' });
      mockTemplateUpdate.mockResolvedValue(fork);

      const result = await service.updateTemplate('t1', { name: 'Renamed' }, { userId: 'admin1', role: 'admin' });

      expect(mockTemplateCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ parent_template_id: 't1', version: 2, status: 'DRAFT' }),
        })
      );
      expect(mockSectionCreate).toHaveBeenCalled();
      expect(mockFieldCreate).toHaveBeenCalled();
      expect(mockSignatureBlockCreate).toHaveBeenCalled();
      expect(result.id).toBe('t2');
    });

    it('refuses to edit an ARCHIVED template', async () => {
      mockTemplateFindUnique.mockResolvedValue(baseTemplate({ status: 'ARCHIVED' }));
      await expect(
        service.updateTemplate('t1', { name: 'x' }, { userId: 'admin1', role: 'admin' })
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('publishTemplate', () => {
    it('rejects publishing a template with no sections', async () => {
      mockTemplateFindUnique.mockResolvedValue(baseTemplate({ sections: [] }));
      await expect(
        service.publishTemplate('t1', { userId: 'admin1', role: 'admin' })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects publishing a template with no signature blocks', async () => {
      mockTemplateFindUnique.mockResolvedValue(
        baseTemplate({
          sections: [{ id: 's1', fields: [], signature_blocks: [] }],
        })
      );
      await expect(
        service.publishTemplate('t1', { userId: 'admin1', role: 'admin' })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('publishes a template with at least one section and one signature block', async () => {
      const draft = baseTemplate({
        sections: [{ id: 's1', fields: [], signature_blocks: [{ id: 'b1' }] }],
      });
      mockTemplateFindUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce({
        ...draft,
        status: 'PUBLISHED',
      });
      mockTemplateUpdate.mockResolvedValue({ ...draft, status: 'PUBLISHED' });

      const result = await service.publishTemplate('t1', { userId: 'admin1', role: 'admin' });
      expect(result.status).toBe('PUBLISHED');
    });
  });

  describe('createInstance — no proxy-fill', () => {
    it('rejects a worker creating an instance for someone else', async () => {
      await expect(
        service.createInstance(
          { template_id: 't1', worker_id: 'w2' },
          { userId: 'w1', role: 'worker' }
        )
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockInstanceCreate).not.toHaveBeenCalled();
    });

    it('allows a worker creating an instance for themself against a PUBLISHED template', async () => {
      mockTemplateFindUnique.mockResolvedValue(baseTemplate({ status: 'PUBLISHED' }));
      mockInstanceCreate.mockResolvedValue({ id: 'i1', worker_id: 'w1', template_id: 't1' });
      mockInstanceFindUnique.mockResolvedValue({
        id: 'i1',
        worker_id: 'w1',
        template_id: 't1',
        created_by_id: 'w1',
        status: 'IN_PROGRESS',
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: null,
        final_document_id: null,
        field_values: [],
        signatures: [],
      });

      const result = await service.createInstance(
        { template_id: 't1', worker_id: 'w1' },
        { userId: 'w1', role: 'worker' }
      );
      expect(result.worker_id).toBe('w1');
    });

    it('rejects creating an instance against a non-PUBLISHED template', async () => {
      mockTemplateFindUnique.mockResolvedValue(baseTemplate({ status: 'DRAFT' }));
      await expect(
        service.createInstance({ template_id: 't1', worker_id: 'w1' }, { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('denies a manager creating an instance for a worker outside their group scope', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g_other' });
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      await expect(
        service.createInstance(
          { template_id: 't1', worker_id: 'w1' },
          { userId: 'm1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
        )
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockInstanceCreate).not.toHaveBeenCalled();
    });
  });

  describe('getInstance — IDOR / group-scope enforcement', () => {
    function instanceRecord(overrides: Record<string, unknown> = {}) {
      return {
        id: 'i1',
        worker_id: 'w2',
        template_id: 't1',
        created_by_id: 'm1',
        status: 'IN_PROGRESS',
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: null,
        final_document_id: null,
        field_values: [],
        signatures: [],
        ...overrides,
      };
    }

    it('rejects a worker reading an instance that is not their own', async () => {
      mockInstanceFindUnique.mockResolvedValue(instanceRecord());
      await expect(
        service.getInstance('i1', { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows a manager to read an instance for a worker in their group scope', async () => {
      mockInstanceFindUnique.mockResolvedValue(instanceRecord());
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const result = await service.getInstance('i1', {
        userId: 'm1',
        role: 'manager',
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      });
      expect(result.id).toBe('i1');
    });

    it('denies a manager reading an instance for a worker outside their group scope', async () => {
      mockInstanceFindUnique.mockResolvedValue(instanceRecord());
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g_other' });
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      await expect(
        service.getInstance('i1', {
          userId: 'm1',
          role: 'manager',
          scope: { type: 'hotel_group', hotel_group_id: 'g1' },
        })
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('denies a regional_manager with no scope claim (deny-by-default)', async () => {
      mockInstanceFindUnique.mockResolvedValue(instanceRecord());
      await expect(
        service.getInstance('i1', { userId: 'rm1', role: 'regional_manager', scope: null })
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows an admin to read any instance (unconditional bypass)', async () => {
      mockInstanceFindUnique.mockResolvedValue(instanceRecord());
      const result = await service.getInstance('i1', { userId: 'a1', role: 'admin' });
      expect(result.id).toBe('i1');
    });
  });

  describe('upsertFieldValues — shared_key propagation', () => {
    it('propagates a value to every sibling field sharing the same shared_key', async () => {
      mockInstanceFindUnique.mockResolvedValue({
        id: 'i1',
        worker_id: 'w1',
        template_id: 't1',
        created_by_id: 'w1',
        status: 'IN_PROGRESS',
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: null,
        final_document_id: null,
        field_values: [],
        signatures: [],
      });
      mockTemplateFindUnique.mockResolvedValue(
        baseTemplate({
          sections: [
            {
              id: 's1',
              fields: [
                { id: 'f1', field_key: 'employee_name', shared_key: 'employee_name' },
              ],
              signature_blocks: [],
            },
            {
              id: 's2',
              fields: [
                { id: 'f2', field_key: 'employee_name_2', shared_key: 'employee_name' },
              ],
              signature_blocks: [],
            },
          ],
        })
      );
      mockFieldValueUpsert.mockResolvedValue({});

      await service.upsertFieldValues(
        'i1',
        { values: [{ field_id: 'f1', value: 'Alona' }] },
        { userId: 'w1', role: 'worker' }
      );

      // First $transaction call = the direct upsert(s); second = shared_key propagation.
      expect(mockTransaction).toHaveBeenCalledTimes(2);
      const propagationCallArgs = mockTransaction.mock.calls[1][0] as unknown[];
      expect(propagationCallArgs).toHaveLength(1);
    });

    it('rejects a field_id that does not belong to the instance template', async () => {
      mockInstanceFindUnique.mockResolvedValue({
        id: 'i1',
        worker_id: 'w1',
        template_id: 't1',
        status: 'IN_PROGRESS',
        field_values: [],
        signatures: [],
      });
      mockTemplateFindUnique.mockResolvedValue(baseTemplate({ sections: [{ id: 's1', fields: [], signature_blocks: [] }] }));

      await expect(
        service.upsertFieldValues(
          'i1',
          { values: [{ field_id: 'nope', value: 'x' }] },
          { userId: 'w1', role: 'worker' }
        )
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects filling a COMPLETED instance', async () => {
      mockInstanceFindUnique.mockResolvedValue({
        id: 'i1',
        worker_id: 'w1',
        template_id: 't1',
        status: 'COMPLETED',
        field_values: [],
        signatures: [],
      });
      await expect(
        service.upsertFieldValues('i1', { values: [] }, { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('signBlock — signer_role RBAC', () => {
    function instance(overrides: Record<string, unknown> = {}) {
      return {
        id: 'i1',
        worker_id: 'w1',
        template_id: 't1',
        created_by_id: 'w1',
        status: 'IN_PROGRESS',
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: null,
        final_document_id: null,
        field_values: [],
        signatures: [],
        ...overrides,
      };
    }

    function subjectBlock() {
      return { id: 'b1', section_id: 's1', signer_role: 'SUBJECT', section: { template_id: 't1' } };
    }

    function countersignerBlock() {
      return { id: 'b1', section_id: 's1', signer_role: 'COUNTERSIGNER', section: { template_id: 't1' } };
    }

    it('rejects a manager signing a SUBJECT block on behalf of a worker (no proxy-fill)', async () => {
      mockInstanceFindUnique.mockResolvedValue(instance());
      mockSignatureBlockFindUnique.mockResolvedValue(subjectBlock());

      await expect(
        service.signBlock('i1', 'b1', Buffer.from('png'), {
          userId: 'm1',
          role: 'manager',
          scope: { type: 'hotel_group', hotel_group_id: 'g1' },
        })
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockInstanceSignatureCreate).not.toHaveBeenCalled();
    });

    it('rejects a worker signing a COUNTERSIGNER block', async () => {
      mockInstanceFindUnique.mockResolvedValue(instance());
      mockSignatureBlockFindUnique.mockResolvedValue(countersignerBlock());

      await expect(
        service.signBlock('i1', 'b1', Buffer.from('png'), { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockInstanceSignatureCreate).not.toHaveBeenCalled();
    });

    it('rejects a worker signing another worker\'s SUBJECT block', async () => {
      mockInstanceFindUnique.mockResolvedValue(instance({ worker_id: 'w2' }));
      mockSignatureBlockFindUnique.mockResolvedValue(subjectBlock());

      await expect(
        service.signBlock('i1', 'b1', Buffer.from('png'), { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows the worker to sign their own SUBJECT block', async () => {
      mockInstanceFindUnique.mockResolvedValue(instance());
      mockSignatureBlockFindUnique.mockResolvedValue(subjectBlock());
      mockTemplateFindUnique.mockResolvedValue(
        baseTemplate({ sections: [{ id: 's1', fields: [], signature_blocks: [] }] })
      );
      mockInstanceSignatureCreate.mockResolvedValue({});
      mockInstanceUpdate.mockResolvedValue({});
      mockInstanceFindUnique.mockResolvedValueOnce(instance()).mockResolvedValueOnce(
        instance({ status: 'AWAITING_SIGNATURES' })
      );

      const result = await service.signBlock('i1', 'b1', Buffer.from('png'), { userId: 'w1', role: 'worker' });
      expect(mockInstanceSignatureCreate).toHaveBeenCalled();
      expect(mockScan).toHaveBeenCalled();
      expect(result.id).toBe('i1');
    });

    it('allows an in-scope manager to sign a COUNTERSIGNER block', async () => {
      mockInstanceFindUnique
        .mockResolvedValueOnce(instance())
        .mockResolvedValueOnce(instance({ status: 'AWAITING_SIGNATURES' }));
      mockSignatureBlockFindUnique.mockResolvedValue(countersignerBlock());
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockTemplateFindUnique.mockResolvedValue(
        baseTemplate({ sections: [{ id: 's1', fields: [], signature_blocks: [] }] })
      );
      mockInstanceSignatureCreate.mockResolvedValue({});
      mockInstanceUpdate.mockResolvedValue({});

      const result = await service.signBlock('i1', 'b1', Buffer.from('png'), {
        userId: 'm1',
        role: 'manager',
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      });
      expect(result.id).toBe('i1');
    });

    it('rejects signing when the malware scan fails', async () => {
      mockInstanceFindUnique.mockResolvedValue(instance());
      mockSignatureBlockFindUnique.mockResolvedValue(subjectBlock());
      mockTemplateFindUnique.mockResolvedValue(
        baseTemplate({ sections: [{ id: 's1', fields: [], signature_blocks: [] }] })
      );
      mockScan.mockResolvedValue({ clean: false, reason: 'infected' });

      await expect(
        service.signBlock('i1', 'b1', Buffer.from('png'), { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockInstanceSignatureCreate).not.toHaveBeenCalled();
    });

    it('rejects signing on a COMPLETED instance', async () => {
      mockInstanceFindUnique.mockResolvedValue(instance({ status: 'COMPLETED' }));
      mockSignatureBlockFindUnique.mockResolvedValue(subjectBlock());

      await expect(
        service.signBlock('i1', 'b1', Buffer.from('png'), { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects double-signing the same block (unique constraint -> ConflictError)', async () => {
      mockInstanceFindUnique.mockResolvedValue(instance());
      mockSignatureBlockFindUnique.mockResolvedValue(subjectBlock());
      mockTemplateFindUnique.mockResolvedValue(
        baseTemplate({ sections: [{ id: 's1', fields: [], signature_blocks: [] }] })
      );
      mockInstanceSignatureCreate.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.signBlock('i1', 'b1', Buffer.from('png'), { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('finalize', () => {
    it('rejects finalizing while any required signature block is unsigned', async () => {
      mockInstanceFindUnique.mockResolvedValue({
        id: 'i1',
        worker_id: 'w1',
        template_id: 't1',
        status: 'AWAITING_SIGNATURES',
        field_values: [],
        signatures: [{ signature_block_id: 'b1' }],
      });
      mockTemplateFindUnique.mockResolvedValue(
        baseTemplate({
          sections: [
            {
              id: 's1',
              fields: [],
              signature_blocks: [{ id: 'b1' }, { id: 'b2' }],
            },
          ],
        })
      );

      await expect(
        service.finalize('i1', { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockUploadDocument).not.toHaveBeenCalled();
    });

    it('finalizes once every required block is signed, uploading via the existing documents service', async () => {
      mockInstanceFindUnique
        .mockResolvedValueOnce({
          id: 'i1',
          worker_id: 'w1',
          template_id: 't1',
          status: 'AWAITING_SIGNATURES',
          field_values: [],
          signatures: [{ signature_block_id: 'b1' }],
        })
        .mockResolvedValueOnce({
          id: 'i1',
          worker_id: 'w1',
          template_id: 't1',
          created_by_id: 'w1',
          status: 'COMPLETED',
          created_at: new Date(),
          updated_at: new Date(),
          completed_at: new Date(),
          final_document_id: 'doc1',
          field_values: [],
          signatures: [
            {
              id: 'sig1',
              signature_block_id: 'b1',
              signed_by_id: 'w1',
              signed_at: new Date(),
              content_hash_at_signing: 'hash',
            },
          ],
        });
      mockTemplateFindUnique.mockResolvedValue(
        baseTemplate({
          sections: [{ id: 's1', fields: [], signature_blocks: [{ id: 'b1' }] }],
        })
      );
      mockUploadDocument.mockResolvedValue({ id: 'doc1' });
      mockInstanceUpdate.mockResolvedValue({});

      const result = await service.finalize('i1', { userId: 'w1', role: 'worker' });

      expect(mockUploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ worker_id: 'w1', category: 'GENERAL' }),
        expect.any(Buffer),
        'worker'
      );
      expect(result.status).toBe('COMPLETED');
      expect(result.final_document_id).toBe('doc1');
    });

    it('rejects finalizing an already-COMPLETED instance', async () => {
      mockInstanceFindUnique.mockResolvedValue({
        id: 'i1',
        worker_id: 'w1',
        template_id: 't1',
        status: 'COMPLETED',
        field_values: [],
        signatures: [],
      });
      await expect(
        service.finalize('i1', { userId: 'w1', role: 'worker' })
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });
});

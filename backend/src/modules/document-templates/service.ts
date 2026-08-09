// Document Templates module (2026-08-09, greenfield). See schema.prisma's
// module header comment for the full signature trust-boundary note.

import crypto from 'node:crypto';
import {
  Prisma,
  DocumentTemplate,
  DocumentTemplateSection,
  DocumentTemplateField,
  DocumentTemplateSignatureBlock,
  DocumentInstance,
  DocumentInstanceFieldValue,
  DocumentInstanceSignature,
  DocumentTemplateStatus,
  DocumentInstanceStatus,
} from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isWorkerInGroupScope, isScopedManagerRole, isSelfScopedRole } from '../../lib/scope.js';
import type { UserScope } from '../../lib/jwt.js';
import { generateStorageKey, getStorageClient } from '../documents/storage.js';
import { documentService } from '../documents/service.js';
import { getMalwareScanner } from '../hr/malware-scan.js';
import { renderInstanceToPdf, renderSectionHtml } from './pdf-renderer.js';
import {
  CreateFieldInput,
  CreateInstanceInput,
  CreateSectionInput,
  CreateSignatureBlockInput,
  CreateTemplateInput,
  DocumentInstanceDto,
  DocumentTemplateDto,
  DocumentTemplateListDto,
  ListInstancesQuery,
  UpdateFieldInput,
  UpdateSectionInput,
  UpdateTemplateInput,
  UpsertFieldValuesInput,
} from './types.js';

type Actor = { userId: string; role: string; scope?: UserScope | null };

type TemplateWithSections = DocumentTemplate & {
  sections: (DocumentTemplateSection & {
    fields: DocumentTemplateField[];
    signature_blocks: DocumentTemplateSignatureBlock[];
  })[];
};

export class DocumentTemplatesService extends BaseService {
  // ---------------------------------------------------------------------
  // Template authoring (admin)
  // ---------------------------------------------------------------------

  async createTemplate(input: CreateTemplateInput, actor: Actor): Promise<DocumentTemplateDto> {
    const template = await this.prisma.documentTemplate.create({
      data: { name: input.name, description: input.description ?? null, created_by_id: actor.userId },
    });
    await this.logAudit(actor.userId, actor.role, 'CREATE_DOCUMENT_TEMPLATE', 'DocumentTemplate', template.id);
    return this.toTemplateListDto(template);
  }

  async listTemplates(query: { page: number; limit: number }): Promise<{ data: DocumentTemplateListDto[]; total: number }> {
    const { page, limit } = query;
    const [templates, total] = await Promise.all([
      this.prisma.documentTemplate.findMany({
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.documentTemplate.count(),
    ]);
    return { data: templates.map((t) => this.toTemplateListDto(t)), total };
  }

  async getTemplate(id: string, actor: Actor): Promise<DocumentTemplateDto> {
    const template = await this.loadTemplateWithSections(id);

    if (actor.role === 'worker') {
      const activeInstance = await this.prisma.documentInstance.findFirst({
        where: { template_id: id, worker_id: actor.userId }
      });
      if (!activeInstance) {
        throw new ForbiddenError('Workers may only read templates for which they have an active document instance');
      }
    }

    return this.toTemplateDto(template);
  }

  private async loadTemplateWithSections(id: string): Promise<TemplateWithSections> {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id },
      include: {
        sections: {
          orderBy: { order_index: 'asc' },
          include: {
            fields: { orderBy: { order_index: 'asc' } },
            signature_blocks: { orderBy: { order_index: 'asc' } },
          },
        },
      },
    });
    if (!template) throw new NotFoundError('Template not found');
    return template;
  }

  // Fork-on-edit (product decision, 2026-08-09): a PUBLISHED template's
  // sections/fields are frozen. Any structural edit (updateTemplate,
  // add/edit section, add/edit field, add signature block) against a
  // PUBLISHED template creates a new DRAFT template row (version+1,
  // parent_template_id set) and performs the edit against the FORK, never
  // the original — so existing DocumentInstances stay bound to the
  // template version they were actually filled against. Returns the
  // template to operate on: the original if still DRAFT, or the newly
  // created fork if PUBLISHED.
  private async resolveEditableTemplate(id: string, actor: Actor): Promise<TemplateWithSections> {
    const template = await this.loadTemplateWithSections(id);
    if (template.status === 'ARCHIVED') {
      throw new ConflictError('Cannot edit an archived template');
    }
    if (template.status === 'DRAFT') return template;

    // PUBLISHED: fork.
    const fork = await this.prisma.$transaction(async (tx) => {
      const newTemplate = await tx.documentTemplate.create({
        data: {
          name: template.name,
          description: template.description,
          status: DocumentTemplateStatus.DRAFT,
          version: template.version + 1,
          parent_template_id: template.id,
          created_by_id: actor.userId,
        },
      });
      for (const section of template.sections) {
        const newSection = await tx.documentTemplateSection.create({
          data: {
            template_id: newTemplate.id,
            title: section.title,
            order_index: section.order_index,
            body_template: section.body_template,
          },
        });
        for (const field of section.fields) {
          await tx.documentTemplateField.create({
            data: {
              section_id: newSection.id,
              field_key: field.field_key,
              label: field.label,
              field_type: field.field_type,
              is_required: field.is_required,
              order_index: field.order_index,
              shared_key: field.shared_key,
              select_options: field.select_options ?? undefined,
              validation: field.validation ?? undefined,
              help_text: field.help_text,
            },
          });
        }
        for (const block of section.signature_blocks) {
          await tx.documentTemplateSignatureBlock.create({
            data: {
              section_id: newSection.id,
              label: block.label,
              signer_role: block.signer_role,
              order_index: block.order_index,
            },
          });
        }
      }
      return newTemplate.id;
    });

    await this.logAudit(actor.userId, actor.role, 'FORK_DOCUMENT_TEMPLATE', 'DocumentTemplate', fork, {
      forked_from: template.id,
    });
    return this.loadTemplateWithSections(fork);
  }

  async updateTemplate(id: string, input: UpdateTemplateInput, actor: Actor): Promise<DocumentTemplateDto> {
    const editable = await this.resolveEditableTemplate(id, actor);
    const updated = await this.prisma.documentTemplate.update({
      where: { id: editable.id },
      data: { name: input.name, description: input.description },
    });
    await this.logAudit(actor.userId, actor.role, 'UPDATE_DOCUMENT_TEMPLATE', 'DocumentTemplate', updated.id);
    return this.getTemplate(updated.id, actor);
  }

  async addSection(templateId: string, input: CreateSectionInput, actor: Actor): Promise<DocumentTemplateDto> {
    const editable = await this.resolveEditableTemplate(templateId, actor);
    try {
      await this.prisma.documentTemplateSection.create({
        data: {
          template_id: editable.id,
          title: input.title,
          order_index: input.order_index,
          body_template: input.body_template,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError('A section with this order_index already exists on this template');
      }
      throw error;
    }
    await this.logAudit(actor.userId, actor.role, 'ADD_DOCUMENT_TEMPLATE_SECTION', 'DocumentTemplate', editable.id);
    return this.getTemplate(editable.id, actor);
  }

  async updateSection(
    templateId: string,
    sectionId: string,
    input: UpdateSectionInput,
    actor: Actor
  ): Promise<DocumentTemplateDto> {
    const editable = await this.resolveEditableTemplate(templateId, actor);
    const section = editable.sections.find((s) => s.id === sectionId);
    // Section ids on a DRAFT-and-unforked template are stable, but after a
    // fork the caller's sectionId (from the pre-fork template) no longer
    // exists on the fork -- surfaces as NotFoundError rather than silently
    // editing nothing, so a caller mid-edit-session against a template that
    // was just published by someone else gets a clear signal to re-fetch.
    if (!section) throw new NotFoundError('Section not found on this template version');

    await this.prisma.documentTemplateSection.update({
      where: { id: sectionId },
      data: { title: input.title, order_index: input.order_index, body_template: input.body_template },
    });
    await this.logAudit(actor.userId, actor.role, 'UPDATE_DOCUMENT_TEMPLATE_SECTION', 'DocumentTemplate', editable.id);
    return this.getTemplate(editable.id, actor);
  }

  async addField(
    templateId: string,
    sectionId: string,
    input: CreateFieldInput,
    actor: Actor
  ): Promise<DocumentTemplateDto> {
    const editable = await this.resolveEditableTemplate(templateId, actor);
    const section = editable.sections.find((s) => s.id === sectionId);
    if (!section) throw new NotFoundError('Section not found on this template version');

    try {
      await this.prisma.documentTemplateField.create({
        data: {
          section_id: sectionId,
          field_key: input.field_key,
          label: input.label,
          field_type: input.field_type,
          is_required: input.is_required,
          order_index: input.order_index,
          signer_role: input.signer_role,
          shared_key: input.shared_key ?? null,
          select_options: input.select_options ? (input.select_options as Prisma.InputJsonValue) : undefined,
          validation: input.validation ? (input.validation as Prisma.InputJsonValue) : undefined,
          help_text: input.help_text ?? null,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError('A field with this field_key already exists in this section');
      }
      throw error;
    }
    await this.logAudit(actor.userId, actor.role, 'ADD_DOCUMENT_TEMPLATE_FIELD', 'DocumentTemplate', editable.id);
    return this.getTemplate(editable.id, actor);
  }

  async updateField(
    templateId: string,
    sectionId: string,
    fieldId: string,
    input: UpdateFieldInput,
    actor: Actor
  ): Promise<DocumentTemplateDto> {
    const editable = await this.resolveEditableTemplate(templateId, actor);
    const section = editable.sections.find((s) => s.id === sectionId);
    if (!section) throw new NotFoundError('Section not found on this template version');
    const field = section.fields.find((f) => f.id === fieldId);
    if (!field) throw new NotFoundError('Field not found in this section');

    await this.prisma.documentTemplateField.update({
      where: { id: fieldId },
      data: {
        label: input.label,
        is_required: input.is_required,
        order_index: input.order_index,
        signer_role: input.signer_role,
        select_options: input.select_options ? (input.select_options as Prisma.InputJsonValue) : undefined,
        validation: input.validation ? (input.validation as Prisma.InputJsonValue) : undefined,
        help_text: input.help_text,
      },
    });
    await this.logAudit(actor.userId, actor.role, 'UPDATE_DOCUMENT_TEMPLATE_FIELD', 'DocumentTemplate', editable.id);
    return this.getTemplate(editable.id, actor);
  }

  async addSignatureBlock(
    templateId: string,
    sectionId: string,
    input: CreateSignatureBlockInput,
    actor: Actor
  ): Promise<DocumentTemplateDto> {
    const editable = await this.resolveEditableTemplate(templateId, actor);
    const section = editable.sections.find((s) => s.id === sectionId);
    if (!section) throw new NotFoundError('Section not found on this template version');

    await this.prisma.documentTemplateSignatureBlock.create({
      data: {
        section_id: sectionId,
        label: input.label,
        signer_role: input.signer_role,
        order_index: input.order_index,
      },
    });
    await this.logAudit(
      actor.userId,
      actor.role,
      'ADD_DOCUMENT_TEMPLATE_SIGNATURE_BLOCK',
      'DocumentTemplate',
      editable.id
    );
    return this.getTemplate(editable.id, actor);
  }

  async publishTemplate(id: string, actor: Actor): Promise<DocumentTemplateDto> {
    const template = await this.loadTemplateWithSections(id);
    if (template.status !== 'DRAFT') {
      throw new ConflictError('Only a DRAFT template can be published');
    }
    if (template.sections.length === 0) {
      throw new ValidationError('A template must have at least one section before publishing');
    }
    const totalSignatureBlocks = template.sections.reduce((n, s) => n + s.signature_blocks.length, 0);
    if (totalSignatureBlocks === 0) {
      throw new ValidationError('A template must define at least one signature block before publishing');
    }

    const updated = await this.prisma.documentTemplate.update({
      where: { id },
      data: { status: DocumentTemplateStatus.PUBLISHED, published_at: new Date() },
    });
    await this.logAudit(actor.userId, actor.role, 'PUBLISH_DOCUMENT_TEMPLATE', 'DocumentTemplate', updated.id);
    return this.getTemplate(updated.id, actor);
  }

  async archiveTemplate(id: string, actor: Actor): Promise<DocumentTemplateDto> {
    const template = await this.prisma.documentTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundError('Template not found');
    if (template.status !== 'PUBLISHED') {
      throw new ConflictError('Only a PUBLISHED template can be archived');
    }
    const updated = await this.prisma.documentTemplate.update({
      where: { id },
      data: { status: DocumentTemplateStatus.ARCHIVED, archived_at: new Date() },
    });
    await this.logAudit(actor.userId, actor.role, 'ARCHIVE_DOCUMENT_TEMPLATE', 'DocumentTemplate', updated.id);
    return this.getTemplate(updated.id, actor);
  }

  // ---------------------------------------------------------------------
  // Instances (fill / sign)
  // ---------------------------------------------------------------------

  async createInstance(input: CreateInstanceInput, actor: Actor): Promise<DocumentInstanceDto> {
    // No proxy-fill (product decision, 2026-08-09): a worker may only
    // create an instance targeting themself.
    if (isSelfScopedRole(actor.role) && input.worker_id !== actor.userId) {
      throw new ForbiddenError('Workers may only create instances for themselves');
    }
    if (isScopedManagerRole(actor.role)) {
      const inScope = await isWorkerInGroupScope(actor.scope ?? null, input.worker_id);
      if (!inScope) throw new ForbiddenError('Cannot create a document instance for this worker');
    }

    const template = await this.prisma.documentTemplate.findUnique({ where: { id: input.template_id } });
    if (!template) throw new NotFoundError('Template not found');
    if (template.status !== 'PUBLISHED') {
      throw new ConflictError('Only a PUBLISHED template can be used to create an instance');
    }

    const instance = await this.prisma.documentInstance.create({
      data: { template_id: template.id, worker_id: input.worker_id, created_by_id: actor.userId },
    });
    await this.logAudit(actor.userId, actor.role, 'CREATE_DOCUMENT_INSTANCE', 'DocumentInstance', instance.id, {
      template_id: template.id,
      worker_id: input.worker_id,
    });
    return this.getInstance(instance.id, actor);
  }

  private async loadInstance(id: string) {
    const instance = await this.prisma.documentInstance.findUnique({
      where: { id },
      include: { field_values: true, signatures: true },
    });
    if (!instance) throw new NotFoundError('Instance not found');
    return instance;
  }

  private async assertInstanceReadAccess(
    instance: DocumentInstance,
    actor: Actor
  ): Promise<void> {
    if (actor.role === 'admin') return;
    if (isSelfScopedRole(actor.role)) {
      if (instance.worker_id !== actor.userId) {
        throw new ForbiddenError('Cannot access this document instance');
      }
      return;
    }
    if (isScopedManagerRole(actor.role)) {
      // Service-layer enforcement (not just route middleware): this
      // repo already had an IDOR bug from that exact mistake in
      // documents/service.ts#getDocument -- copy the fix, not the bug.
      const inScope = await isWorkerInGroupScope(actor.scope ?? null, instance.worker_id);
      if (!inScope) throw new ForbiddenError('Cannot access this document instance');
      return;
    }
    throw new ForbiddenError('Cannot access this document instance');
  }

  async getInstance(id: string, actor: Actor): Promise<DocumentInstanceDto> {
    const instance = await this.loadInstance(id);
    await this.assertInstanceReadAccess(instance, actor);
    return this.toInstanceDto(instance);
  }

  async listInstances(query: ListInstancesQuery, actor: Actor): Promise<{ data: DocumentInstanceDto[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;

    if (isSelfScopedRole(actor.role)) {
      where.worker_id = actor.userId;
    } else if (query.worker_id) {
      if (isScopedManagerRole(actor.role)) {
        const inScope = await isWorkerInGroupScope(actor.scope ?? null, query.worker_id);
        if (!inScope) return { data: [], total: 0 };
      }
      where.worker_id = query.worker_id;
    } else if (isScopedManagerRole(actor.role)) {
      // No worker_id filter supplied by a group-scoped manager/RM: narrow
      // to their group via the worker's EmploymentRecord, mirroring the
      // resolveNonAdminScopeFilter shape used elsewhere for list reads.
      const scope = actor.scope ?? null;
      if (!scope) {
        return { data: [], total: 0 };
      } else if (scope.type === 'hotel') {
        const hotel = await this.prisma.hotel.findUnique({
          where: { id: scope.hotel_id },
          select: { hotel_group_id: true },
        });
        where.worker = { employment_record: { hotel_group_id: hotel?.hotel_group_id ?? '__none__' } };
      } else if (scope.type === 'hotel_group') {
        where.worker = { employment_record: { hotel_group_id: scope.hotel_group_id } };
      }
    }

    const [records, total] = await Promise.all([
      this.prisma.documentInstance.findMany({
        where,
        include: { field_values: true, signatures: true },
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.documentInstance.count({ where }),
    ]);
    return { data: records.map((r) => this.toInstanceDto(r)), total };
  }

  async upsertFieldValues(
    instanceId: string,
    input: UpsertFieldValuesInput,
    actor: Actor
  ): Promise<DocumentInstanceDto> {
    const instance = await this.loadInstance(instanceId);
    await this.assertInstanceFillAccess(instance, actor);

    if (instance.status === 'COMPLETED' || instance.status === 'VOIDED') {
      throw new ConflictError(`Cannot edit field values on a ${instance.status} instance`);
    }

    const template = await this.loadTemplateWithSections(instance.template_id);
    const validFields = new Map(template.sections.flatMap((s) => s.fields.map((f) => [f.id, f])));

    for (const v of input.values) {
      const field = validFields.get(v.field_id);
      if (!field) {
        throw new ValidationError(`field_id ${v.field_id} does not belong to this instance's template`);
      }

      if ((field.signer_role ?? 'SUBJECT') === 'SUBJECT') {
        if (!isSelfScopedRole(actor.role) || instance.worker_id !== actor.userId) {
          throw new ForbiddenError(`Only the worker this document is about may fill SUBJECT-role fields (field: ${field.label})`);
        }
      } else {
        if (actor.role === 'admin') {
          // unrestricted
        } else if (isScopedManagerRole(actor.role)) {
          const inScope = await isWorkerInGroupScope(actor.scope ?? null, instance.worker_id);
          if (!inScope) throw new ForbiddenError(`Cannot fill COUNTERSIGNER-role fields (field: ${field.label})`);
        } else {
          throw new ForbiddenError(`Cannot fill COUNTERSIGNER-role fields (field: ${field.label})`);
        }
      }
    }

    await this.prisma.$transaction(
      input.values.map((v) =>
        this.prisma.documentInstanceFieldValue.upsert({
          where: { instance_id_field_id: { instance_id: instanceId, field_id: v.field_id } },
          create: { instance_id: instanceId, field_id: v.field_id, value: v.value, updated_by_id: actor.userId },
          update: { value: v.value, updated_by_id: actor.userId },
        })
      )
    );

    // shared_key resolution: propagate a freshly-written value to every
    // OTHER field in the same template sharing the same shared_key, so a
    // value entered in one section pre-fills every section that references
    // it, without the caller having to know which sections share which keys.
    for (const v of input.values) {
      const field = template.sections.flatMap((s) => s.fields).find((f) => f.id === v.field_id);
      if (!field?.shared_key) continue;
      const siblingFieldIds = template.sections
        .flatMap((s) => s.fields)
        .filter((f) => f.shared_key === field.shared_key && f.id !== field.id)
        .map((f) => f.id);
      if (siblingFieldIds.length === 0) continue;
      await this.prisma.$transaction(
        siblingFieldIds.map((fid) =>
          this.prisma.documentInstanceFieldValue.upsert({
            where: { instance_id_field_id: { instance_id: instanceId, field_id: fid } },
            create: { instance_id: instanceId, field_id: fid, value: v.value, updated_by_id: actor.userId },
            update: { value: v.value, updated_by_id: actor.userId },
          })
        )
      );
    }

    await this.logAudit(actor.userId, actor.role, 'UPDATE_DOCUMENT_INSTANCE_FIELDS', 'DocumentInstance', instanceId);
    return this.getInstance(instanceId, actor);
  }

  private async assertInstanceFillAccess(instance: DocumentInstance, actor: Actor): Promise<void> {
    if (actor.role === 'admin') return;
    if (isSelfScopedRole(actor.role)) {
      if (instance.worker_id !== actor.userId) {
        throw new ForbiddenError('Workers may only fill their own document instance');
      }
      return;
    }
    if (isScopedManagerRole(actor.role)) {
      const inScope = await isWorkerInGroupScope(actor.scope ?? null, instance.worker_id);
      if (!inScope) throw new ForbiddenError('Cannot fill this document instance');
      return;
    }
    throw new ForbiddenError('Cannot fill this document instance');
  }

  async previewInstance(instanceId: string, actor: Actor): Promise<Buffer> {
    const instance = await this.loadInstance(instanceId);
    await this.assertInstanceReadAccess(instance, actor);
    const template = await this.loadTemplateWithSections(instance.template_id);
    return renderInstanceToPdf(template, instance, { draft: true });
  }

  // ---------------------------------------------------------------------
  // Signature capture
  // ---------------------------------------------------------------------

  async signBlock(
    instanceId: string,
    blockId: string,
    imageBuffer: Buffer,
    actor: Actor,
    actorIp?: string
  ): Promise<DocumentInstanceDto> {
    const instance = await this.loadInstance(instanceId);

    const block = await this.prisma.documentTemplateSignatureBlock.findUnique({
      where: { id: blockId },
      include: { section: true },
    });
    if (!block || block.section.template_id !== instance.template_id) {
      throw new NotFoundError('Signature block not found on this instance');
    }

    // Role must match the block's own signer_role: a SUBJECT block can
    // only be signed by the worker (self-scoped), a COUNTERSIGNER block
    // only by admin/manager (group-scoped) -- never the other way, and
    // never on behalf of someone else (no proxy-fill, product decision).
    if (block.signer_role === 'SUBJECT') {
      if (!isSelfScopedRole(actor.role) || instance.worker_id !== actor.userId) {
        throw new ForbiddenError('Only the worker this document is about may sign this block');
      }
    } else {
      if (actor.role === 'admin') {
        // unrestricted
      } else if (isScopedManagerRole(actor.role)) {
        const inScope = await isWorkerInGroupScope(actor.scope ?? null, instance.worker_id);
        if (!inScope) throw new ForbiddenError('Cannot sign this block');
      } else {
        throw new ForbiddenError('Cannot sign this block');
      }
    }

    if (instance.status === 'COMPLETED' || instance.status === 'VOIDED') {
      throw new ConflictError(`Cannot sign on a ${instance.status} instance`);
    }

    const scanner = getMalwareScanner();
    const scan = await scanner.scan(imageBuffer);
    if (!scan.clean) {
      throw new ValidationError(`Signature image rejected: ${scan.reason ?? 'failed malware scan'}`);
    }

    const storageKey = generateStorageKey(instance.worker_id, 'signature', 'signature.png');
    const storage = await getStorageClient();
    await storage.upload(storageKey, imageBuffer, 'image/png');

    let signatureRecord;
    try {
      signatureRecord = await this.prisma.documentInstanceSignature.create({
        data: {
          instance_id: instanceId,
          signature_block_id: blockId,
          signed_by_id: actor.userId,
          signature_image_key: storageKey,
          signer_ip: actorIp ?? null,
          content_hash_at_signing: '', // temporary, will update below
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError('This signature block has already been signed on this instance');
      }
      throw error;
    }

    // Refresh instance to include the new signature before computing the hash
    const updatedInstance = await this.loadInstance(instanceId);
    const template = await this.loadTemplateWithSections(instance.template_id);
    const section = template.sections.find((s) => s.id === block.section_id);
    if (!section) throw new NotFoundError('Section not found for this signature block');
    
    // Hash computed after signature is saved so it reflects the signed state
    // We pass stableHashMode=true to avoid volatile presigned URLs in the hash.
    const sectionHtml = await renderSectionHtml(section, updatedInstance, true);
    const contentHash = crypto.createHash('sha256').update(sectionHtml).digest('hex');

    await this.prisma.documentInstanceSignature.update({
      where: { id: signatureRecord.id },
      data: { content_hash_at_signing: contentHash },
    });

    await this.prisma.documentInstance.update({
      where: { id: instanceId },
      data: { status: DocumentInstanceStatus.AWAITING_SIGNATURES },
    });

    await this.logAudit(
      actor.userId,
      actor.role,
      'document_instance.sign',
      'DocumentInstanceSignature',
      instanceId,
      { signature_block_id: blockId },
      actorIp
    );

    return this.getInstance(instanceId, actor);
  }

  async listSignatures(instanceId: string, actor: Actor): Promise<DocumentInstanceDto['signatures']> {
    const instance = await this.loadInstance(instanceId);
    await this.assertInstanceReadAccess(instance, actor);
    
    const storage = await getStorageClient();
    return Promise.all(
      instance.signatures.map(async (s) => ({
        id: s.id,
        signature_block_id: s.signature_block_id,
        signed_by_id: s.signed_by_id,
        signature_image_url: (await storage.getPresignedUrl(s.signature_image_key).catch(() => null)) ?? null,
        signed_at: s.signed_at.toISOString(),
        content_hash_at_signing: s.content_hash_at_signing,
      }))
    );
  }

  async finalize(instanceId: string, actor: Actor): Promise<DocumentInstanceDto> {
    const instance = await this.loadInstance(instanceId);
    await this.assertInstanceFillAccess(instance, actor);

    if (instance.status === 'COMPLETED') {
      throw new ConflictError('Instance is already completed');
    }
    if (instance.status === 'VOIDED') {
      throw new ConflictError('Cannot finalize a voided instance');
    }

    const template = await this.loadTemplateWithSections(instance.template_id);
    const requiredBlockIds = template.sections.flatMap((s) => s.signature_blocks.map((b) => b.id));
    const signedBlockIds = new Set(instance.signatures.map((s) => s.signature_block_id));
    const missing = requiredBlockIds.filter((id) => !signedBlockIds.has(id));
    if (missing.length > 0) {
      throw new ValidationError(`Cannot finalize: ${missing.length} signature block(s) still unsigned`);
    }

    const pdfBuffer = await renderInstanceToPdf(template, instance, { draft: false });
    const doc = await documentService.uploadDocument(
      {
        worker_id: instance.worker_id,
        actor_id: actor.userId,
        category: 'GENERAL',
        original_filename: `${template.name}.pdf`,
        mime_type: 'application/pdf',
        file_size_bytes: pdfBuffer.length,
      },
      pdfBuffer,
      actor.role
    );

    const updated = await this.prisma.documentInstance.update({
      where: { id: instanceId },
      data: {
        status: DocumentInstanceStatus.COMPLETED,
        completed_at: new Date(),
        final_document_id: doc.id,
      },
    });

    await this.logAudit(actor.userId, actor.role, 'FINALIZE_DOCUMENT_INSTANCE', 'DocumentInstance', updated.id, {
      final_document_id: doc.id,
    });

    return this.getInstance(updated.id, actor);
  }

  async getFinalDocumentUrl(instanceId: string, actor: Actor): Promise<string | null> {
    const instance = await this.loadInstance(instanceId);
    await this.assertInstanceReadAccess(instance, actor);
    if (!instance.final_document_id) {
      throw new ConflictError('Instance has no final document yet');
    }
    const doc = await documentService.getDocument(instance.final_document_id, actor.userId, actor.role, actor.scope);
    return doc.presigned_url ?? null;
  }

  // ---------------------------------------------------------------------
  // DTO mapping
  // ---------------------------------------------------------------------

  private toTemplateListDto(t: DocumentTemplate): DocumentTemplateListDto {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      status: t.status,
      version: t.version,
      parent_template_id: t.parent_template_id,
      created_by_id: t.created_by_id,
      created_at: t.created_at.toISOString(),
      updated_at: t.updated_at.toISOString(),
      published_at: t.published_at?.toISOString() ?? null,
      archived_at: t.archived_at?.toISOString() ?? null,
    };
  }

  private toTemplateDto(t: TemplateWithSections): DocumentTemplateDto {
    return {
      ...this.toTemplateListDto(t),
      sections: t.sections.map((s) => ({
        id: s.id,
        template_id: s.template_id,
        title: s.title,
        order_index: s.order_index,
        body_template: s.body_template,
        fields: s.fields.map((f) => ({
          id: f.id,
          section_id: f.section_id,
          field_key: f.field_key,
          label: f.label,
          field_type: f.field_type,
          is_required: f.is_required,
          order_index: f.order_index,
          shared_key: f.shared_key,
          select_options: (f.select_options as string[] | null) ?? null,
          validation: (f.validation as Record<string, unknown> | null) ?? null,
          help_text: f.help_text,
        })),
        signature_blocks: s.signature_blocks.map((b) => ({
          id: b.id,
          section_id: b.section_id,
          label: b.label,
          signer_role: b.signer_role,
          order_index: b.order_index,
        })),
      })),
    };
  }

  private toInstanceDto(
    i: DocumentInstance & { field_values: DocumentInstanceFieldValue[]; signatures: DocumentInstanceSignature[] }
  ): DocumentInstanceDto {
    return {
      id: i.id,
      template_id: i.template_id,
      worker_id: i.worker_id,
      created_by_id: i.created_by_id,
      status: i.status,
      created_at: i.created_at.toISOString(),
      updated_at: i.updated_at.toISOString(),
      completed_at: i.completed_at?.toISOString() ?? null,
      final_document_id: i.final_document_id,
      field_values: i.field_values.map((v) => ({
        id: v.id,
        field_id: v.field_id,
        value: v.value,
        updated_at: v.updated_at.toISOString(),
        updated_by_id: v.updated_by_id,
      })),
      // signature_image_url is resolved lazily (presigned URL) only where
      // actually needed (listSignatures reads through getStorageClient
      // itself, not duplicated here) -- toInstanceDto's own callers that
      // don't need the image URL avoid an unnecessary S3 round-trip.
      signatures: i.signatures.map((s) => ({
        id: s.id,
        signature_block_id: s.signature_block_id,
        signed_by_id: s.signed_by_id,
        signature_image_url: null,
        signed_at: s.signed_at.toISOString(),
        content_hash_at_signing: s.content_hash_at_signing,
      })),
    };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export const documentTemplatesService = new DocumentTemplatesService();

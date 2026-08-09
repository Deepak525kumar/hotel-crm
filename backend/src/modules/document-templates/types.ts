// Document Templates module (2026-08-09, greenfield). See the schema.prisma
// module header comment for the full signature trust-boundary note
// (attestation capture, not a legally-binding cryptographic e-signature).

import { z } from 'zod';

export const FIELD_TYPES = ['TEXT', 'DATE', 'NUMBER', 'CHECKBOX', 'SELECT', 'INFO_BLOCK'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const SIGNER_ROLES = ['SUBJECT', 'COUNTERSIGNER'] as const;
export type SignerRoleType = (typeof SIGNER_ROLES)[number];

// ---------------------------------------------------------------------------
// Template authoring (admin)
// ---------------------------------------------------------------------------

export const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});
export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;

export const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
});
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateSchema>;

export const ListTemplatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListTemplatesQuery = z.infer<typeof ListTemplatesQuerySchema>;


export const CreateSectionSchema = z.object({
  title: z.string().min(1).max(300),
  order_index: z.number().int().min(0),
  body_template: z.string().min(1),
});
export type CreateSectionInput = z.infer<typeof CreateSectionSchema>;

export const UpdateSectionSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  order_index: z.number().int().min(0).optional(),
  body_template: z.string().min(1).optional(),
});
export type UpdateSectionInput = z.infer<typeof UpdateSectionSchema>;

// select_options required (non-empty) when field_type === SELECT; enforced
// via .refine() below rather than a discriminated union, since every other
// field carries the same base shape and a discriminated union would force
// callers to branch on field_type before they can even validate.
export const CreateFieldSchema = z
  .object({
    field_key: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*$/, 'field_key must be lowercase snake_case'),
    label: z.string().min(1).max(300),
    field_type: z.enum(FIELD_TYPES),
    is_required: z.boolean().default(true),
    order_index: z.number().int().min(0),
    signer_role: z.enum(SIGNER_ROLES).default('SUBJECT'),
    shared_key: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*$/, 'shared_key must be lowercase snake_case')
      .optional(),
    select_options: z.array(z.string().min(1).max(200)).max(50).optional(),
    validation: z.record(z.unknown()).optional(),
    help_text: z.string().max(500).optional(),
  })
  .refine(
    (data) => data.field_type !== 'SELECT' || (data.select_options && data.select_options.length > 0),
    { message: 'select_options is required and must be non-empty for field_type SELECT', path: ['select_options'] }
  );
export type CreateFieldInput = z.infer<typeof CreateFieldSchema>;

export const UpdateFieldSchema = z.object({
  label: z.string().min(1).max(300).optional(),
  is_required: z.boolean().optional(),
  order_index: z.number().int().min(0).optional(),
  signer_role: z.enum(SIGNER_ROLES).optional(),
  select_options: z.array(z.string().min(1).max(200)).max(50).optional(),
  validation: z.record(z.unknown()).optional(),
  help_text: z.string().max(500).optional(),
});
export type UpdateFieldInput = z.infer<typeof UpdateFieldSchema>;

export const CreateSignatureBlockSchema = z.object({
  label: z.string().min(1).max(300),
  signer_role: z.enum(SIGNER_ROLES),
  order_index: z.number().int().min(0),
});
export type CreateSignatureBlockInput = z.infer<typeof CreateSignatureBlockSchema>;

// ---------------------------------------------------------------------------
// Instance fill (worker / manager / admin)
// ---------------------------------------------------------------------------

export const CreateInstanceSchema = z.object({
  template_id: z.string().min(1),
  worker_id: z.string().min(1),
});
export type CreateInstanceInput = z.infer<typeof CreateInstanceSchema>;

// One upsert call carries every field the caller is allowed to touch in one
// request (typically one section's worth) — field_id keys are validated
// against the template server-side, never trusted as exhaustive/complete.
export const UpsertFieldValuesSchema = z.object({
  values: z
    .array(
      z.object({
        field_id: z.string().min(1),
        value: z.string().max(10000).nullable(),
      })
    )
    .min(1)
    .max(200),
});
export type UpsertFieldValuesInput = z.infer<typeof UpsertFieldValuesSchema>;

export const ListInstancesQuerySchema = z.object({
  worker_id: z.string().optional(),
  status: z.enum(['IN_PROGRESS', 'AWAITING_SIGNATURES', 'COMPLETED', 'VOIDED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListInstancesQuery = z.infer<typeof ListInstancesQuerySchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface DocumentTemplateFieldDto {
  id: string;
  section_id: string;
  field_key: string;
  label: string;
  field_type: FieldType;
  is_required: boolean;
  order_index: number;
  shared_key: string | null;
  select_options: string[] | null;
  validation: Record<string, unknown> | null;
  help_text: string | null;
}

export interface DocumentTemplateSignatureBlockDto {
  id: string;
  section_id: string;
  label: string;
  signer_role: SignerRoleType;
  order_index: number;
}

export interface DocumentTemplateSectionDto {
  id: string;
  template_id: string;
  title: string;
  order_index: number;
  body_template: string;
  fields: DocumentTemplateFieldDto[];
  signature_blocks: DocumentTemplateSignatureBlockDto[];
}

export interface DocumentTemplateDto {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  version: number;
  parent_template_id: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
  // Sections are included in the detail read (GET /:id) but omitted from
  // the list read for payload size — TemplateListDto below is what list
  // returns.
  sections?: DocumentTemplateSectionDto[];
}

export type DocumentTemplateListDto = Omit<DocumentTemplateDto, 'sections'>;

export interface DocumentInstanceFieldValueDto {
  id: string;
  field_id: string;
  value: string | null;
  updated_at: string;
  updated_by_id: string;
}

export interface DocumentInstanceSignatureDto {
  id: string;
  signature_block_id: string;
  signed_by_id: string;
  // Never the raw S3 key — a presigned URL, mirroring WorkerDocumentDto's
  // s3_key-never-in-DTO convention.
  signature_image_url: string | null;
  signed_at: string;
  content_hash_at_signing: string;
}

export interface DocumentInstanceDto {
  id: string;
  template_id: string;
  worker_id: string;
  created_by_id: string;
  status: 'IN_PROGRESS' | 'AWAITING_SIGNATURES' | 'COMPLETED' | 'VOIDED';
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  final_document_id: string | null;
  field_values: DocumentInstanceFieldValueDto[];
  signatures: DocumentInstanceSignatureDto[];
}

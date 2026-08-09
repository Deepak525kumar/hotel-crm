"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useAuthStore } from "@/stores/auth";
import { useDocumentInstance, useDocumentTemplate } from "@/hooks/useDocumentTemplates";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { documentTemplatesApi } from "@/lib/api";
import { SignatureCaptureModal } from "@/components/document-templates/SignatureCaptureModal";
import { formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  FormError,
  Input,
  PageHeader,
  Select,
  Skeleton,
  TextLink,
} from "@/components/ui";
import type {
  DocumentInstanceDto,
  DocumentInstanceFieldValueDto,
  DocumentInstanceSignatureDto,
  DocumentTemplateFieldDto,
  DocumentTemplateSectionDto,
  DocumentTemplateSignatureBlockDto,
} from "@/lib/types";

const STATUS_TONE: Record<
  DocumentInstanceDto["status"],
  "neutral" | "success" | "warning" | "danger"
> = {
  IN_PROGRESS: "neutral",
  AWAITING_SIGNATURES: "warning",
  COMPLETED: "success",
  VOIDED: "danger",
};

function refreshInstance(id: string) {
  return globalMutate(["document-instance", id]);
}

export default function DocumentInstancePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: instance, isLoading, error } = useDocumentInstance(id);
  const { data: template, isLoading: templateLoading } = useDocumentTemplate(instance?.template_id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <TextLink href="/document-instances" className="text-sm">
        ← Back to document instances
      </TextLink>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600">
            Failed to load this document. It may have been removed, or you may not have access.
          </CardContent>
        </Card>
      ) : isLoading || !instance || templateLoading || !template ? (
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      ) : (
        <InstanceWizard instance={instance} template={template} />
      )}
    </div>
  );
}

function InstanceWizard({
  instance,
  template,
}: {
  instance: DocumentInstanceDto;
  template: NonNullable<ReturnType<typeof useDocumentTemplate>["data"]>;
}) {
  const currentUser = useAuthStore((s) => s.user);
  const sections = (template.sections ?? []).slice().sort((a, b) => a.order_index - b.order_index);
  const [preview, setPreview] = useState<{ url: string } | null>(null);
  const previewAction = useAsyncAction();
  const finalize = useAsyncAction();
  const [finalDocUrl, setFinalDocUrl] = useState<string | null | undefined>(undefined);
  const finalDocAction = useAsyncAction();

  const valuesByFieldId = useMemo(() => {
    const map = new Map<string, DocumentInstanceFieldValueDto>();
    for (const v of instance.field_values) map.set(v.field_id, v);
    return map;
  }, [instance.field_values]);

  const signaturesByBlockId = useMemo(
    () => new Map(instance.signatures.map((s) => [s.signature_block_id, s])),
    [instance.signatures],
  );

  const allBlocks = sections.flatMap((s) => s.signature_blocks);
  const allSigned = allBlocks.length > 0 && allBlocks.every((b) => signaturesByBlockId.has(b.id));

  const isSubject = currentUser?.id === instance.worker_id;
  const isCounterparty =
    currentUser?.role === "admin" ||
    currentUser?.role === "manager" ||
    currentUser?.role === "regional_manager";

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPreview = () =>
    previewAction.run(() => documentTemplatesApi.previewInstance(instance.id), {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        if (preview) URL.revokeObjectURL(preview.url);
        setPreview({ url });
        window.open(url, "_blank", "noopener,noreferrer");
      },
    });

  const onFinalize = () =>
    finalize.run(() => documentTemplatesApi.finalize(instance.id), {
      onSuccess: () => refreshInstance(instance.id),
    });

  const loadFinalDocument = () =>
    finalDocAction.run(() => documentTemplatesApi.getFinalDocument(instance.id), {
      onSuccess: (res) => setFinalDocUrl(res.url),
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {template.name}
            <Badge tone={STATUS_TONE[instance.status]}>{instance.status.replace(/_/g, " ")}</Badge>
          </span>
        }
        description={template.description || undefined}
        actions={
          <Button variant="outline" onClick={onPreview} loading={previewAction.isPending()}>
            Preview PDF
          </Button>
        }
      />
      <FormError>{previewAction.error}</FormError>

      {sections.map((section) => (
        <SectionStep
          key={section.id}
          instance={instance}
          section={section}
          valuesByFieldId={valuesByFieldId}
          signaturesByBlockId={signaturesByBlockId}
          isSubject={isSubject}
          isCounterparty={isCounterparty}
        />
      ))}

      {instance.status !== "COMPLETED" && instance.status !== "VOIDED" && (
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Finalize</p>
                <p className="text-sm text-gray-500">
                  {allSigned
                    ? "Every signature block is signed — this instance can now be finalized into a signed PDF."
                    : "All signature blocks must be signed before this instance can be finalized."}
                </p>
              </div>
              <Button onClick={onFinalize} loading={finalize.pending} disabled={!allSigned}>
                Finalize
              </Button>
            </div>
            <FormError>{finalize.error}</FormError>
          </CardContent>
        </Card>
      )}

      {instance.status === "COMPLETED" && (
        <Card>
          <CardHeader>
            <CardTitle>Signed document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {finalDocUrl === undefined ? (
              <Button variant="outline" onClick={loadFinalDocument} loading={finalDocAction.pending}>
                Get signed document link
              </Button>
            ) : finalDocUrl ? (
              <a
                href={finalDocUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                View signed document
              </a>
            ) : (
              <p className="text-sm text-gray-500">
                Storage is not configured in this environment — the signed document link is unavailable.
              </p>
            )}
            <FormError>{finalDocAction.error}</FormError>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SectionStep({
  instance,
  section,
  valuesByFieldId,
  signaturesByBlockId,
  isSubject,
  isCounterparty,
}: {
  instance: DocumentInstanceDto;
  section: DocumentTemplateSectionDto;
  valuesByFieldId: Map<string, DocumentInstanceFieldValueDto>;
  signaturesByBlockId: Map<string, DocumentInstanceSignatureDto>;
  isSubject: boolean;
  isCounterparty: boolean;
}) {
  const fields = section.fields.slice().sort((a, b) => a.order_index - b.order_index);
  const blocks = section.signature_blocks.slice().sort((a, b) => a.order_index - b.order_index);
  const canEdit = instance.status === "IN_PROGRESS" || instance.status === "AWAITING_SIGNATURES";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap text-sm text-gray-500">{renderBody(section.body_template, valuesByFieldId, fields)}</p>

        {fields.length > 0 && (
          <div className="space-y-4 border-t border-gray-100 pt-4">
            {fields.map((field) => {
              const existing = valuesByFieldId.get(field.id);
              return (
                <FieldInput
                  // Keyed by field id + the persisted value's own
                  // updated_at (not the value itself, which would remount
                  // and drop the optimistic local edit on every keystroke's
                  // commit) -- only an EXTERNAL revalidation (a different
                  // updated_at than what this component last committed)
                  // should reset local state, per React's "reset state via
                  // key" pattern rather than a setState-in-effect.
                  key={`${field.id}:${existing?.updated_at ?? "unset"}`}
                  instanceId={instance.id}
                  field={field}
                  value={existing?.value ?? null}
                  disabled={!canEdit}
                />
              );
            })}
          </div>
        )}

        {blocks.length > 0 && (
          <div className="space-y-2 border-t border-gray-100 pt-4">
            {blocks.map((block) => (
              <SignatureRow
                key={block.id}
                instanceId={instance.id}
                block={block}
                signature={signaturesByBlockId.get(block.id) ?? null}
                isSubject={isSubject}
                isCounterparty={isCounterparty}
                instanceStatus={instance.status}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Substitutes `{{field_key}}` placeholders with the current filled value (or a blank) for a live preview of the prose. */
function renderBody(
  template: string,
  valuesByFieldId: Map<string, DocumentInstanceFieldValueDto>,
  fields: DocumentTemplateFieldDto[],
): string {
  const byKey = new Map(fields.map((f) => [f.field_key, f]));
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const field = byKey.get(key);
    if (!field) return match;
    const value = valuesByFieldId.get(field.id)?.value;
    return value ?? `[${field.label}]`;
  });
}

function FieldInput({
  instanceId,
  field,
  value,
  disabled,
}: {
  instanceId: string;
  field: DocumentTemplateFieldDto;
  value: string | null;
  disabled: boolean;
}) {
  const [localValue, setLocalValue] = useState(value ?? "");
  const save = useAsyncAction();

  if (field.field_type === "INFO_BLOCK") {
    return (
      <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">{field.label}</div>
    );
  }

  const commit = (next: string) => {
    if (next === (value ?? "")) return;
    save.run(() =>
      documentTemplatesApi.upsertFieldValues(instanceId, {
        values: [{ field_id: field.id, value: next === "" ? null : next }],
      }),
    );
  };

  if (field.field_type === "CHECKBOX") {
    return (
      <div>
        <Checkbox
          label={`${field.label}${field.is_required ? " *" : ""}`}
          hint={field.help_text ?? undefined}
          checked={localValue === "true"}
          disabled={disabled || save.pending}
          onChange={(e) => {
            const next = e.target.checked ? "true" : "false";
            setLocalValue(next);
            commit(next);
          }}
        />
        <FormError>{save.error}</FormError>
      </div>
    );
  }

  if (field.field_type === "SELECT") {
    return (
      <div>
        <Select
          label={`${field.label}${field.is_required ? " *" : ""}`}
          hint={field.help_text ?? undefined}
          value={localValue}
          disabled={disabled || save.pending}
          placeholder="Choose…"
          options={(field.select_options ?? []).map((opt) => ({ value: opt, label: opt }))}
          onChange={(e) => {
            setLocalValue(e.target.value);
            commit(e.target.value);
          }}
        />
        <FormError>{save.error}</FormError>
      </div>
    );
  }

  const inputType = field.field_type === "DATE" ? "date" : field.field_type === "NUMBER" ? "number" : "text";

  return (
    <div>
      <Input
        label={`${field.label}${field.is_required ? " *" : ""}`}
        hint={field.help_text ?? undefined}
        type={inputType}
        value={localValue}
        disabled={disabled || save.pending}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
      />
      <FormError>{save.error}</FormError>
    </div>
  );
}

function SignatureRow({
  instanceId,
  block,
  signature,
  isSubject,
  isCounterparty,
  instanceStatus,
}: {
  instanceId: string;
  block: DocumentTemplateSignatureBlockDto;
  signature: DocumentInstanceSignatureDto | null;
  isSubject: boolean;
  isCounterparty: boolean;
  instanceStatus: DocumentInstanceDto["status"];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const signed = signature !== null;

  // UX affordance only, mirroring RoleGate's own precedent: the real
  // enforcement is the backend's per-block signer_role/actor check
  // (requireInstanceSignAccess + service-layer verification) -- this just
  // decides which button/label to show so a viewer never taps "Sign" only
  // to get a 403 for a block that was never theirs to sign.
  const eligible = block.signer_role === "SUBJECT" ? isSubject : isCounterparty;
  const canSign = eligible && !signed && (instanceStatus === "IN_PROGRESS" || instanceStatus === "AWAITING_SIGNATURES");

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-md border border-gray-100 px-3 py-2">
        <div>
          <p className="text-sm font-medium text-gray-900">{block.label}</p>
          <p className="text-xs text-gray-500">
            {block.signer_role === "SUBJECT" ? "Worker" : "Employer"} signature
            {signature && ` · Signed ${formatDateTime(signature.signed_at)}`}
          </p>
        </div>
        {signed ? (
          <Badge tone="success">Signed</Badge>
        ) : canSign ? (
          <Button size="sm" onClick={() => setModalOpen(true)}>
            Sign
          </Button>
        ) : (
          <Badge tone="neutral">
            {block.signer_role === "SUBJECT" ? "Waiting for worker" : "Waiting for employer"}
          </Badge>
        )}
      </div>
      <SignatureCaptureModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        instanceId={instanceId}
        blockId={block.id}
        blockLabel={block.label}
        onSigned={() => {
          setModalOpen(false);
          refreshInstance(instanceId);
        }}
      />
    </>
  );
}

"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useDocumentTemplate } from "@/hooks/useDocumentTemplates";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { documentTemplatesApi } from "@/lib/api";
import { DocumentTemplatesWriteGate } from "@/components/auth/RoleGate";
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
  Textarea,
  TextLink,
} from "@/components/ui";
import type {
  DocumentFieldType,
  DocumentSignerRole,
  DocumentTemplateDto,
  DocumentTemplateSectionDto,
  DocumentTemplateStatus,
} from "@/lib/types";

const STATUS_TONE: Record<DocumentTemplateStatus, "neutral" | "success" | "warning"> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "warning",
};

const FIELD_TYPE_OPTIONS: { value: DocumentFieldType; label: string }[] = [
  { value: "TEXT", label: "Text" },
  { value: "DATE", label: "Date" },
  { value: "NUMBER", label: "Number" },
  { value: "CHECKBOX", label: "Checkbox" },
  { value: "SELECT", label: "Select (dropdown)" },
  { value: "INFO_BLOCK", label: "Info block (read-only)" },
];

const SIGNER_ROLE_OPTIONS: { value: DocumentSignerRole; label: string }[] = [
  { value: "SUBJECT", label: "Subject (the worker)" },
  { value: "COUNTERSIGNER", label: "Countersigner (employer)" },
];

/**
 * Notifies the editor that a mutation touching `resultTemplateId` completed,
 * so it can refresh and, if that id differs from the template currently
 * being edited, treat it as a fork. Every write endpoint under
 * `/document-templates/:id/...` (create/update section, add/update field,
 * add signature block, update/publish/archive template — service.ts)
 * returns the WHOLE template dto, not the sub-resource just created, so
 * `dto.id` is always available and always the id to compare/redirect to.
 */
type OnMutated = (resultTemplateId: string) => Promise<void>;

function refreshTemplateLists() {
  return globalMutate((key) => Array.isArray(key) && key[0] === "document-templates");
}

/**
 * Remounting on route id change (`key={params.id}`) discards all local form
 * state (open/closed sections, in-progress add-field forms) whenever the
 * URL itself changes -- including the fork-redirect below, which updates the
 * URL via `history.replaceState` specifically so it does NOT trigger this
 * remount mid-edit (see `DocumentTemplateEditor`'s own `activeId` state).
 */
export default function DocumentTemplateEditorPage() {
  const params = useParams<{ id: string }>();
  return <DocumentTemplateEditor key={params.id} routeId={params.id} />;
}

function DocumentTemplateEditor({ routeId }: { routeId: string }) {
  const router = useRouter();
  const [activeId, setActiveId] = useState(routeId);
  const { data: template, isLoading, error } = useDocumentTemplate(activeId);
  const [forkNotice, setForkNotice] = useState(false);

  // Fork-on-edit (document-templates/service.ts): any write while the
  // template is PUBLISHED returns/references a NEW forked draft id rather
  // than the id that was called. `history.replaceState` (not
  // `router.replace`, which would remount this whole page and lose the
  // notice banner mid-render) keeps the address bar and any future reload
  // pointed at the live draft.
  const onMutated: OnMutated = async (resultTemplateId) => {
    if (resultTemplateId !== activeId) {
      window.history.replaceState(null, "", `/document-templates/${resultTemplateId}`);
      setActiveId(resultTemplateId);
      setForkNotice(true);
    }
    await Promise.all([refreshTemplateLists(), globalMutate(["document-template", resultTemplateId])]);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <TextLink href="/document-templates" className="text-sm">
        ← Back to templates
      </TextLink>

      {forkNotice && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This template was published — your edit created a new draft version. You are now
          editing that draft.
        </div>
      )}

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600">
            Failed to load this template. It may have been removed.
          </CardContent>
        </Card>
      ) : isLoading || !template ? (
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      ) : (
        <TemplateEditorBody
          template={template}
          onMutated={onMutated}
          onArchived={() => router.push("/document-templates")}
        />
      )}
    </div>
  );
}

function TemplateEditorBody({
  template,
  onMutated,
  onArchived,
}: {
  template: DocumentTemplateDto;
  onMutated: OnMutated;
  onArchived: () => void;
}) {
  const [addingSection, setAddingSection] = useState(false);
  const publish = useAsyncAction();
  const archive = useAsyncAction();

  const sections = template.sections ?? [];
  const canPublish = template.status === "DRAFT";
  const publishBlockedReason =
    sections.length === 0
      ? "Add at least one section before publishing."
      : sections.every((s) => s.signature_blocks.length === 0)
        ? "Add at least one signature block before publishing."
        : null;

  const onPublish = () =>
    publish.run(() => documentTemplatesApi.publishTemplate(template.id), {
      onSuccess: (dto) => onMutated(dto.id),
    });

  const onArchive = () =>
    archive.run(() => documentTemplatesApi.archiveTemplate(template.id), {
      onSuccess: async (dto) => {
        await onMutated(dto.id);
        onArchived();
      },
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {template.name}
            <Badge tone={STATUS_TONE[template.status]}>{template.status}</Badge>
            <span className="text-sm font-normal text-gray-500">v{template.version}</span>
          </span>
        }
        description={template.description || undefined}
        actions={
          <DocumentTemplatesWriteGate>
            <div className="flex flex-col items-end gap-1">
              <div className="flex gap-2">
                {canPublish && (
                  <Button
                    onClick={onPublish}
                    loading={publish.pending}
                    disabled={!!publishBlockedReason}
                    title={publishBlockedReason ?? undefined}
                  >
                    Publish
                  </Button>
                )}
                {template.status === "PUBLISHED" && (
                  <Button variant="outline" onClick={onArchive} loading={archive.pending}>
                    Archive
                  </Button>
                )}
              </div>
              {canPublish && publishBlockedReason && (
                <span className="text-xs text-gray-500">{publishBlockedReason}</span>
              )}
            </div>
          </DocumentTemplatesWriteGate>
        }
      />
      <FormError>{publish.error ?? archive.error}</FormError>

      {sections.length === 0 && !addingSection ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500">
            No sections yet.
          </CardContent>
        </Card>
      ) : (
        sections
          .slice()
          .sort((a, b) => a.order_index - b.order_index)
          .map((section) => (
            <SectionCard
              key={section.id}
              templateId={template.id}
              section={section}
              onMutated={onMutated}
            />
          ))
      )}

      <DocumentTemplatesWriteGate>
        {addingSection ? (
          <AddSectionForm
            templateId={template.id}
            nextOrderIndex={sections.length}
            onMutated={onMutated}
            onDone={() => setAddingSection(false)}
          />
        ) : (
          <Button variant="outline" onClick={() => setAddingSection(true)}>
            Add section
          </Button>
        )}
      </DocumentTemplatesWriteGate>
    </div>
  );
}

function AddSectionForm({
  templateId,
  nextOrderIndex,
  onMutated,
  onDone,
}: {
  templateId: string;
  nextOrderIndex: number;
  onMutated: OnMutated;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const create = useAsyncAction();

  const onSubmit = () => {
    if (!title.trim() || !bodyTemplate.trim()) {
      create.setError("Title and body are required.");
      return;
    }
    create.run(
      () =>
        documentTemplatesApi.addSection(templateId, {
          title: title.trim(),
          order_index: nextOrderIndex,
          body_template: bodyTemplate,
        }),
      {
        onSuccess: async (dto) => {
          await onMutated(dto.id);
          onDone();
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add section</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <Textarea
          label="Body template"
          hint="Prose with {{field_key}} placeholders."
          value={bodyTemplate}
          onChange={(e) => setBodyTemplate(e.target.value)}
          rows={4}
        />
        <FormError>{create.error}</FormError>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onDone} disabled={create.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            Add section
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  templateId,
  section,
  onMutated,
}: {
  templateId: string;
  section: DocumentTemplateSectionDto;
  onMutated: OnMutated;
}) {
  const [editing, setEditing] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [addingBlock, setAddingBlock] = useState(false);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{section.title}</CardTitle>
        <DocumentTemplatesWriteGate>
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </Button>
        </DocumentTemplatesWriteGate>
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <EditSectionForm
            templateId={templateId}
            section={section}
            onMutated={onMutated}
            onDone={() => setEditing(false)}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-gray-700">{section.body_template}</p>
        )}

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fields</h4>
          {section.fields.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">No fields yet.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {section.fields
                .slice()
                .sort((a, b) => a.order_index - b.order_index)
                .map((f) => (
                  <li key={f.id} className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-900">{f.label}</span>
                    <span className="font-mono text-xs text-gray-500">{f.field_key}</span>
                    <Badge tone="neutral">{f.field_type}</Badge>
                    {f.is_required && <Badge tone="info">Required</Badge>}
                  </li>
                ))}
            </ul>
          )}
          <DocumentTemplatesWriteGate>
            {addingField ? (
              <AddFieldForm
                templateId={templateId}
                sectionId={section.id}
                nextOrderIndex={section.fields.length}
                onMutated={onMutated}
                onDone={() => setAddingField(false)}
              />
            ) : (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setAddingField(true)}>
                Add field
              </Button>
            )}
          </DocumentTemplatesWriteGate>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Signature blocks
          </h4>
          {section.signature_blocks.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">No signature blocks yet.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {section.signature_blocks
                .slice()
                .sort((a, b) => a.order_index - b.order_index)
                .map((b) => (
                  <li key={b.id} className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-900">{b.label}</span>
                    <Badge tone={b.signer_role === "SUBJECT" ? "info" : "warning"}>
                      {b.signer_role}
                    </Badge>
                  </li>
                ))}
            </ul>
          )}
          <DocumentTemplatesWriteGate>
            {addingBlock ? (
              <AddSignatureBlockForm
                templateId={templateId}
                sectionId={section.id}
                nextOrderIndex={section.signature_blocks.length}
                onMutated={onMutated}
                onDone={() => setAddingBlock(false)}
              />
            ) : (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setAddingBlock(true)}>
                Add signature block
              </Button>
            )}
          </DocumentTemplatesWriteGate>
        </div>
      </CardContent>
    </Card>
  );
}

function EditSectionForm({
  templateId,
  section,
  onMutated,
  onDone,
}: {
  templateId: string;
  section: DocumentTemplateSectionDto;
  onMutated: OnMutated;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(section.title);
  const [bodyTemplate, setBodyTemplate] = useState(section.body_template);
  const update = useAsyncAction();

  const onSubmit = () => {
    update.run(
      () =>
        documentTemplatesApi.updateSection(templateId, section.id, {
          title: title.trim() || undefined,
          body_template: bodyTemplate.trim() || undefined,
        }),
      {
        onSuccess: async (dto) => {
          await onMutated(dto.id);
          onDone();
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea
        label="Body template"
        value={bodyTemplate}
        onChange={(e) => setBodyTemplate(e.target.value)}
        rows={4}
      />
      <FormError>{update.error}</FormError>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={update.pending}>
          Cancel
        </Button>
        <Button onClick={onSubmit} loading={update.pending}>
          Save
        </Button>
      </div>
    </div>
  );
}

function SelectOptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const addOption = () => {
    const value = draft.trim();
    if (!value || options.includes(value)) return;
    onChange([...options, value]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-700">Select options</label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <span
            key={opt}
            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
          >
            {opt}
            <button
              type="button"
              onClick={() => onChange(options.filter((o) => o !== opt))}
              aria-label={`Remove ${opt}`}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOption();
            }
          }}
          placeholder="Add an option…"
        />
        <Button type="button" variant="outline" onClick={addOption}>
          Add
        </Button>
      </div>
    </div>
  );
}

function AddFieldForm({
  templateId,
  sectionId,
  nextOrderIndex,
  onMutated,
  onDone,
}: {
  templateId: string;
  sectionId: string;
  nextOrderIndex: number;
  onMutated: OnMutated;
  onDone: () => void;
}) {
  const [fieldKey, setFieldKey] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<DocumentFieldType>("TEXT");
  const [isRequired, setIsRequired] = useState(true);
  const [helpText, setHelpText] = useState("");
  const [selectOptions, setSelectOptions] = useState<string[]>([]);
  const create = useAsyncAction();

  const onSubmit = () => {
    const key = fieldKey.trim();
    if (!key || !/^[a-z][a-z0-9_]*$/.test(key)) {
      create.setError("Field key must be lowercase snake_case (e.g. full_name).");
      return;
    }
    if (!label.trim()) {
      create.setError("Label is required.");
      return;
    }
    if (fieldType === "SELECT" && selectOptions.length === 0) {
      create.setError("Add at least one select option.");
      return;
    }
    create.run(
      () =>
        documentTemplatesApi.addField(templateId, sectionId, {
          field_key: key,
          label: label.trim(),
          field_type: fieldType,
          is_required: isRequired,
          order_index: nextOrderIndex,
          select_options: fieldType === "SELECT" ? selectOptions : undefined,
          help_text: helpText.trim() || undefined,
        }),
      {
        onSuccess: async (dto) => {
          await onMutated(dto.id);
          onDone();
        },
      },
    );
  };

  return (
    <Card className="mt-2">
      <CardContent className="space-y-4">
        <Input
          label="Field key"
          hint="Lowercase snake_case, referenced as {{field_key}} in the section body."
          value={fieldKey}
          onChange={(e) => setFieldKey(e.target.value)}
          autoFocus
        />
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Select
          label="Field type"
          value={fieldType}
          onChange={(e) => setFieldType(e.target.value as DocumentFieldType)}
          options={FIELD_TYPE_OPTIONS}
        />
        {fieldType === "SELECT" && (
          <SelectOptionsEditor options={selectOptions} onChange={setSelectOptions} />
        )}
        <Checkbox
          label="Required"
          checked={isRequired}
          onChange={(e) => setIsRequired(e.target.checked)}
        />
        <Input
          label="Help text (optional)"
          value={helpText}
          onChange={(e) => setHelpText(e.target.value)}
        />
        <FormError>{create.error}</FormError>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onDone} disabled={create.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            Add field
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddSignatureBlockForm({
  templateId,
  sectionId,
  nextOrderIndex,
  onMutated,
  onDone,
}: {
  templateId: string;
  sectionId: string;
  nextOrderIndex: number;
  onMutated: OnMutated;
  onDone: () => void;
}) {
  const [label, setLabel] = useState("");
  const [signerRole, setSignerRole] = useState<DocumentSignerRole>("SUBJECT");
  const create = useAsyncAction();

  const onSubmit = () => {
    if (!label.trim()) {
      create.setError("Label is required.");
      return;
    }
    create.run(
      () =>
        documentTemplatesApi.addSignatureBlock(templateId, sectionId, {
          label: label.trim(),
          signer_role: signerRole,
          order_index: nextOrderIndex,
        }),
      {
        onSuccess: async (dto) => {
          await onMutated(dto.id);
          onDone();
        },
      },
    );
  };

  return (
    <Card className="mt-2">
      <CardContent className="space-y-4">
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        <Select
          label="Signer role"
          value={signerRole}
          onChange={(e) => setSignerRole(e.target.value as DocumentSignerRole)}
          options={SIGNER_ROLE_OPTIONS}
        />
        <FormError>{create.error}</FormError>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onDone} disabled={create.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            Add signature block
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

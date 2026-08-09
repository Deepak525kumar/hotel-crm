"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { ApiError, documentTemplatesApi } from "@/lib/api";
import { DocumentTemplatesWriteGate } from "@/components/auth/RoleGate";
import {
  Button,
  Card,
  CardContent,
  FormError,
  Input,
  PageHeader,
  Textarea,
  TextLink,
} from "@/components/ui";

function NewDocumentTemplate() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await documentTemplatesApi.createTemplate({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      await mutate(["document-templates"]);
      router.replace(`/document-templates/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <TextLink href="/document-templates" className="text-sm">
          ← Back to templates
        </TextLink>
        <PageHeader
          className="mt-2"
          title="New template"
          description="Starts as a DRAFT. Add sections, fields, and signature blocks before publishing."
        />
      </div>
      <Card>
        <CardContent className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <FormError>{error}</FormError>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.push("/document-templates")} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={onSubmit} loading={submitting}>
              Create template
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewDocumentTemplatePage() {
  return (
    <DocumentTemplatesWriteGate
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500">
              Only admins can create document templates.
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewDocumentTemplate />
    </DocumentTemplatesWriteGate>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { useDocumentTemplates } from "@/hooks/useDocumentTemplates";
import { useUserOptions } from "@/hooks/useHotels";
import { ApiError, documentTemplatesApi } from "@/lib/api";
import { Button, Card, CardContent, FormError, PageHeader, Select, TextLink } from "@/components/ui";

export default function NewDocumentInstancePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isWorker = user?.role === "worker";

  const { templates, isLoading: templatesLoading } = useDocumentTemplates();
  const publishedTemplates = templates.filter((t) => t.status === "PUBLISHED");

  // No proxy-fill: a worker never picks a target worker (implicitly
  // themself); a manager/RM/admin picks from the worker directory. Scoping
  // that directory to the manager's own group is a backend/`GET /users`
  // concern already handled server-side -- this page just lists whatever
  // `useUserOptions` returns.
  const { users: workers, isLoading: workersLoading } = useUserOptions({ role: "worker" });

  const [templateId, setTemplateId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!templateId) {
      setError("Choose a template.");
      return;
    }
    const targetWorkerId = isWorker ? user!.id : workerId;
    if (!targetWorkerId) {
      setError("Choose a worker.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await documentTemplatesApi.createInstance({
        template_id: templateId,
        worker_id: targetWorkerId,
      });
      router.replace(`/document-instances/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <TextLink href="/document-instances" className="text-sm">
          ← Back to document instances
        </TextLink>
        <PageHeader
          className="mt-2"
          title="New document instance"
          description={
            isWorker
              ? "Start filling in a published template."
              : "Start a published template for a worker."
          }
        />
      </div>
      <Card>
        <CardContent className="space-y-4">
          <Select
            label="Template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            placeholder={templatesLoading ? "Loading…" : "Choose a template"}
            options={publishedTemplates.map((t) => ({ value: t.id, label: t.name }))}
          />
          {!templatesLoading && publishedTemplates.length === 0 && (
            <p className="text-sm text-gray-500">
              No published templates yet — ask an admin to publish one first.
            </p>
          )}

          {!isWorker && (
            <Select
              label="Worker"
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              placeholder={workersLoading ? "Loading…" : "Choose a worker"}
              options={workers.map((w) => ({
                value: w.id,
                label: `${w.first_name} ${w.last_name}`,
              }))}
            />
          )}

          <FormError>{error}</FormError>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.push("/document-instances")} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={onSubmit} loading={submitting}>
              Create instance
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

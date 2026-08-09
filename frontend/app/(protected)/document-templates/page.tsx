"use client";

import Link from "next/link";
import { useDocumentTemplates } from "@/hooks/useDocumentTemplates";
import { DocumentTemplatesWriteGate } from "@/components/auth/RoleGate";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Table,
  TBody,
  TableSkeleton,
  TD,
  TH,
  THead,
  TR,
  TextLink,
} from "@/components/ui";
import type { DocumentTemplateStatus } from "@/lib/types";

const STATUS_TONE: Record<DocumentTemplateStatus, "neutral" | "success" | "warning"> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "warning",
};

export default function DocumentTemplatesPage() {
  const { templates, isLoading, error } = useDocumentTemplates();
  const columns = 4;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document templates"
        description="Reusable, section-based templates for worker-facing forms and signed documents."
        actions={
          <DocumentTemplatesWriteGate>
            <Link href="/document-templates/new">
              <Button>New template</Button>
            </Link>
          </DocumentTemplatesWriteGate>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load templates. Please try again.
            </div>
          ) : (
            <Table aria-label="Document templates">
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Status</TH>
                  <TH>Version</TH>
                  <TH>Updated</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={columns} />
              ) : templates.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={columns} className="p-0">
                      <EmptyState
                        title="No templates yet"
                        description="Create a template to start authoring a reusable document."
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {templates.map((t) => (
                    <TR key={t.id}>
                      <TD className="font-medium">
                        <TextLink href={`/document-templates/${t.id}`} className="block">
                          {t.name}
                        </TextLink>
                      </TD>
                      <TD>
                        <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                      </TD>
                      <TD className="text-gray-500">v{t.version}</TD>
                      <TD className="text-gray-500">
                        {new Date(t.updated_at).toLocaleDateString()}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

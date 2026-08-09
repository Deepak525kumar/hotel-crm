"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth";
import { useDocumentInstances } from "@/hooks/useDocumentTemplates";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Pager,
  PageHeader,
  Select,
  Table,
  TBody,
  TableSkeleton,
  TD,
  TH,
  THead,
  TR,
  TextLink,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { DocumentInstanceStatus } from "@/lib/types";

const STATUS_TONE: Record<DocumentInstanceStatus, "neutral" | "success" | "warning" | "danger"> = {
  IN_PROGRESS: "neutral",
  AWAITING_SIGNATURES: "warning",
  COMPLETED: "success",
  VOIDED: "danger",
};

const STATUS_FILTERS: { value: "" | DocumentInstanceStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "AWAITING_SIGNATURES", label: "Awaiting signatures" },
  { value: "COMPLETED", label: "Completed" },
  { value: "VOIDED", label: "Voided" },
];

const PER_PAGE = 20;

export default function DocumentInstancesPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [status, setStatus] = useState<"" | DocumentInstanceStatus>("");
  const [page, setPage] = useState(1);

  // Self-scope (worker) vs. group-scope (manager/RM/admin) is resolved
  // entirely server-side (requireInstanceReadAccess) -- no `worker_id` param
  // is sent here, so a worker sees only their own instances and everyone
  // else sees their group's, without this page needing to know the split.
  const { instances, isLoading, error } = useDocumentInstances({
    status: status || undefined,
    page,
    per_page: PER_PAGE,
  });

  const onStatusChange = (value: string) => {
    setStatus(value as "" | DocumentInstanceStatus);
    setPage(1);
  };

  const columns = 4;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document instances"
        description={
          role === "worker"
            ? "Documents assigned to you to fill in and sign."
            : "Documents in progress across your scope."
        }
        actions={
          <Link href="/document-instances/new">
            <Button>New instance</Button>
          </Link>
        }
      />

      <div className="w-full sm:max-w-xs">
        <Select
          label="Status"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          options={STATUS_FILTERS}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load document instances. Please try again.
            </div>
          ) : (
            <Table aria-label="Document instances">
              <THead>
                <tr>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH>Updated</TH>
                  <TH>Completed</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={columns} />
              ) : instances.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={columns} className="p-0">
                      <EmptyState
                        title="No document instances"
                        description="Create an instance from a published template to get started."
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {instances.map((i) => (
                    <TR key={i.id}>
                      <TD className="font-medium">
                        <TextLink href={`/document-instances/${i.id}`} className="block">
                          <Badge tone={STATUS_TONE[i.status]}>{i.status.replace(/_/g, " ")}</Badge>
                        </TextLink>
                      </TD>
                      <TD className="text-gray-500">{formatDateTime(i.created_at)}</TD>
                      <TD className="text-gray-500">{formatDateTime(i.updated_at)}</TD>
                      <TD className="text-gray-500">{formatDateTime(i.completed_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      <Pager
        page={page}
        hasNext={instances.length >= PER_PAGE}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}

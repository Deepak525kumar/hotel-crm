"use client";

import Link from "next/link";
import { useDocumentInstances } from "@/hooks/useDocumentTemplates";
import { formatDateTime } from "@/lib/format";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  TextLink,
} from "@/components/ui";
import type { DocumentInstanceStatus } from "@/lib/types";

const STATUS_TONE: Record<DocumentInstanceStatus, "neutral" | "success" | "warning" | "danger"> = {
  IN_PROGRESS: "neutral",
  AWAITING_SIGNATURES: "warning",
  COMPLETED: "success",
  VOIDED: "danger",
};

/**
 * A worker's own documents-to-fill-and-sign, surfaced on their `/users/:id`
 * profile — mirrors ContractCard/DocumentsCard's structure. `worker_id` is
 * passed explicitly (not relying on self-scope inference) so this also
 * renders correctly for a manager/RM/admin viewing a WORKER's profile, not
 * only the worker's own self-view; `GET /document-instances` resolves
 * group-scope vs. self-scope server-side either way
 * (`requireInstanceReadAccess`), so this never needs to know which case it's in.
 */
export function MyDocumentInstancesCard({ workerId }: { workerId: string }) {
  const { instances, isLoading, error } = useDocumentInstances({ worker_id: workerId });
  // Only the still-actionable ones belong on a profile summary card — a
  // completed/voided instance is better found via the full document
  // instances list, not repeated here indefinitely.
  const active = instances.filter(
    (i) => i.status === "IN_PROGRESS" || i.status === "AWAITING_SIGNATURES",
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents to sign</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="py-6 text-center text-sm text-red-600">
            Failed to load document instances.
          </p>
        ) : isLoading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            title="Nothing pending"
            description="No documents currently need filling in or signing."
          />
        ) : (
          <ul>
            {active.map((instance) => (
              <li
                key={instance.id}
                className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <TextLink href={`/document-instances/${instance.id}`} className="block truncate text-sm font-medium">
                    Document instance
                  </TextLink>
                  <p className="text-xs text-gray-500">
                    Started {formatDateTime(instance.created_at)}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[instance.status]}>
                  {instance.status.replace(/_/g, " ")}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 border-t border-gray-100 pt-4">
          <Link href="/document-instances" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            View all document instances →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

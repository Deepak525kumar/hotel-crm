"use client";

import { useParams } from "next/navigation";
import { useWorkRequest } from "@/hooks/useWorkRequests";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { ApiError, workRequestsApi } from "@/lib/api";
import { StaffingWriteGate } from "@/components/auth/RoleGate";
import { WorkRequestStatusBadge } from "@/components/work-requests/StatusBadge";
import { formatDateTime } from "@/lib/format";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  FormError,
  PageHeader,
  Skeleton,
  TextLink,
} from "@/components/ui";

export default function WorkRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: request, isLoading, error, mutate } = useWorkRequest(id);
  const publish = useAsyncAction();

  const onPublish = () =>
    publish.run(() => workRequestsApi.publish(id), {
      // Optimistically replace the cached value with the server response.
      onSuccess: (updated) => mutate(updated, { revalidate: false }),
      errorMessage: "Failed to publish. Please try again.",
    });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-4 w-40" />
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="space-y-4">
        <TextLink href="/requests" className="text-sm">
          ← Back to work requests
        </TextLink>
        <Card>
          <CardContent className="text-sm text-red-600">
            {error instanceof ApiError && error.status === 404
              ? "This work request was not found."
              : "Failed to load this work request."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <TextLink href="/requests" className="text-sm">
          ← Back to work requests
        </TextLink>
        <PageHeader
          className="mt-2"
          title={
            <span className="flex items-center gap-3">
              {request.position}
              <WorkRequestStatusBadge status={request.status} />
            </span>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shift details</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow label="Shift date" value={request.shift_date} />
            <DataRow
              label="Time"
              value={`${request.shift_start_time}–${request.shift_end_time}`}
            />
            <DataRow
              label="Staffing"
              value={`${request.workers_confirmed}/${request.workers_needed} confirmed`}
            />
            <DataRow
              label="Hourly rate"
              value={
                request.hourly_rate != null
                  ? `${request.hourly_rate} ${request.currency}`
                  : "—"
              }
            />
            <DataRow
              label="Published"
              value={
                request.published_at
                  ? formatDateTime(request.published_at)
                  : "Not published"
              }
            />
            {request.expires_at && (
              <DataRow label="Expires" value={formatDateTime(request.expires_at)} />
            )}
            {request.cancellation_reason && (
              <DataRow
                label="Cancellation reason"
                value={request.cancellation_reason}
              />
            )}
          </DataList>
        </CardContent>
      </Card>

      {(request.description || request.requirements) && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-700">
            {request.description && (
              <div>
                <p className="font-medium text-gray-900">Description</p>
                <p className="whitespace-pre-wrap">{request.description}</p>
              </div>
            )}
            {request.requirements && (
              <div>
                <p className="font-medium text-gray-900">Requirements</p>
                <p className="whitespace-pre-wrap">{request.requirements}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <StaffingWriteGate>
        {request.status === "DRAFT" && (
          <Card>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="text-sm text-gray-600">
                This request is a draft. Publish it to open it for staffing.
              </div>
              <Button onClick={onPublish} loading={publish.pending}>
                Publish
              </Button>
            </CardContent>
          </Card>
        )}
      </StaffingWriteGate>

      <FormError>{publish.error}</FormError>
    </div>
  );
}

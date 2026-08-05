"use client";

import { useState } from "react";
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
  Modal,
  PageHeader,
  Skeleton,
  TextLink,
  Textarea,
} from "@/components/ui";

export default function WorkRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: request, isLoading, error, mutate } = useWorkRequest(id);
  const action = useAsyncAction();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const onPublish = () =>
    action.run(() => workRequestsApi.publish(id), {
      key: "publish",
      // Optimistically replace the cached value with the server response.
      onSuccess: (updated) => mutate(updated, { revalidate: false }),
      errorMessage: "Failed to publish. Please try again.",
    });

  const onCancel = () =>
    action.run(
      () => workRequestsApi.cancel(id, cancelReason.trim() || undefined),
      {
        key: "cancel",
        onSuccess: async (updated) => {
          await mutate(updated, { revalidate: false });
          setCancelOpen(false);
          setCancelReason("");
        },
        errorMessage: "Failed to cancel. Please try again.",
      },
    );

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
        {(() => {
          const canPublish = request.status === "DRAFT";
          const canCancel =
            request.status === "DRAFT" ||
            request.status === "OPEN" ||
            request.status === "PARTIALLY_FILLED";

          if (!canPublish && !canCancel) return null;

          return (
            <Card>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="text-sm text-gray-600">
                  {canPublish
                    ? "This request is a draft. Publish it to open it for staffing."
                    : "Manage this work request's status."}
                </div>
                <div className="flex shrink-0 gap-2">
                  {canCancel && (
                    <Button
                      variant="outline"
                      onClick={() => setCancelOpen(true)}
                      disabled={action.pending}
                    >
                      Cancel
                    </Button>
                  )}
                  {canPublish && (
                    <Button
                      onClick={onPublish}
                      loading={action.isPending("publish")}
                      disabled={action.isPending("cancel")}
                    >
                      Publish
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })()}
      </StaffingWriteGate>

      <FormError>{action.error}</FormError>

      <Modal
        open={cancelOpen}
        onClose={() => {
          if (!action.isPending("cancel")) setCancelOpen(false);
        }}
        title="Cancel work request"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={action.isPending("cancel")}
            >
              Keep request
            </Button>
            <Button
              variant="danger"
              onClick={onCancel}
              loading={action.isPending("cancel")}
            >
              Cancel request
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason (optional)"
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="Share why this work request was cancelled."
        />
      </Modal>
    </div>
  );
}

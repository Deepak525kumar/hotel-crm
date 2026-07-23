"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useAssignment } from "@/hooks/useAssignments";
import { assignmentsApi, ApiError } from "@/lib/api";
import { AssignmentStatusBadge } from "@/components/assignments/AssignmentStatusBadge";
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
  Textarea,
  TextLink,
} from "@/components/ui";

export default function AssignmentDetailPage() {
  const params = useParams<{ id: string }>();
  const { id } = params;

  const { data: assignment, isLoading, error, mutate } = useAssignment(id);

  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const busy = starting || completing || cancelling;

  const start = async () => {
    setActionError(null);
    setStarting(true);
    try {
      const updated = await assignmentsApi.start(id);
      await mutate(updated, { revalidate: false });
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Failed to start assignment. Please try again.",
      );
    } finally {
      setStarting(false);
    }
  };

  const complete = async () => {
    setActionError(null);
    setCompleting(true);
    try {
      const updated = await assignmentsApi.complete(id);
      await mutate(updated, { revalidate: false });
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Failed to complete assignment. Please try again.",
      );
    } finally {
      setCompleting(false);
    }
  };

  const cancel = async () => {
    setActionError(null);
    setCancelling(true);
    try {
      const updated = await assignmentsApi.cancel(
        id,
        cancelReason.trim() || undefined,
      );
      await mutate(updated, { revalidate: false });
      setCancelOpen(false);
      setCancelReason("");
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Failed to cancel assignment. Please try again.",
      );
    } finally {
      setCancelling(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-4 w-32" />
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="space-y-4">
        <TextLink
          href="/assignments"
          className="text-sm"
        >
          ← Back to assignments
        </TextLink>
        <Card>
          <CardContent className="text-sm text-red-600">
            {error instanceof ApiError && error.status === 404
              ? "This assignment was not found."
              : "This assignment was not found or could not be loaded."}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Backend transition table: CONFIRMED → IN_PROGRESS/CANCELLED,
  // IN_PROGRESS → COMPLETED/CANCELLED. Other states are terminal here.
  const canStart = assignment.status === "CONFIRMED";
  const canComplete = assignment.status === "IN_PROGRESS";
  const canCancel =
    assignment.status === "CONFIRMED" || assignment.status === "IN_PROGRESS";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <TextLink
          href="/assignments"
          className="text-sm"
        >
          ← Back to assignments
        </TextLink>
        <PageHeader
          className="mt-2"
          title={
            <span className="flex items-center gap-3">
              Assignment
              <AssignmentStatusBadge status={assignment.status} />
            </span>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow label="Worker" value={assignment.worker_id} />
            <DataRow
              label="Work request"
              value={
                <TextLink
                  href={`/requests/${assignment.work_request_id}`}
                >
                  {assignment.work_request_id}
                </TextLink>
              }
            />
            <DataRow label="Hotel" value={assignment.hotel_id} />
            <DataRow label="Assigned by" value={assignment.assigned_by_id} />
            <DataRow
              label="Confirmed"
              value={formatDateTime(assignment.confirmed_at)}
            />
            {assignment.started_at && (
              <DataRow
                label="Started"
                value={formatDateTime(assignment.started_at)}
              />
            )}
            {assignment.completed_at && (
              <DataRow
                label="Completed"
                value={formatDateTime(assignment.completed_at)}
              />
            )}
            {assignment.cancelled_at && (
              <DataRow
                label="Cancelled"
                value={formatDateTime(assignment.cancelled_at)}
              />
            )}
            {assignment.cancellation_reason && (
              <DataRow
                label="Cancellation reason"
                value={assignment.cancellation_reason}
              />
            )}
          </DataList>
        </CardContent>
      </Card>

      {(canStart || canComplete || canCancel) && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              Manage this assignment&apos;s status. Transitions follow the
              shift lifecycle.
            </div>
            <div className="flex shrink-0 gap-2">
              {canCancel && (
                <Button
                  variant="outline"
                  onClick={() => setCancelOpen(true)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              )}
              {canStart && (
                <Button onClick={start} loading={starting} disabled={cancelling}>
                  Start shift
                </Button>
              )}
              {canComplete && (
                <Button
                  onClick={complete}
                  loading={completing}
                  disabled={cancelling}
                >
                  Complete
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <FormError>{actionError}</FormError>

      <Modal
        open={cancelOpen}
        onClose={() => {
          if (!cancelling) setCancelOpen(false);
        }}
        title="Cancel assignment"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={cancelling}
            >
              Keep assignment
            </Button>
            <Button variant="danger" onClick={cancel} loading={cancelling}>
              Cancel assignment
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
          placeholder="Share why this assignment was cancelled."
        />
      </Modal>
    </div>
  );
}

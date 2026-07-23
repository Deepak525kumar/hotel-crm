"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWorkApplication } from "@/hooks/useWorkApplications";
import { workApplicationsApi, ApiError } from "@/lib/api";
import { ManagerAdminGate } from "@/components/auth/RoleGate";
import { ApplicationStatusBadge } from "@/components/work-applications/ApplicationStatusBadge";
import { formatDateTime, formatScore } from "@/lib/format";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  Modal,
  PageHeader,
  Skeleton,
  Textarea,
} from "@/components/ui";

export default function ApplicationReviewPage() {
  const params = useParams<{ id: string; applicationId: string }>();
  const { id, applicationId } = params;

  const { data: application, isLoading, error, mutate } = useWorkApplication(
    id,
    applicationId,
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const accept = async () => {
    setActionError(null);
    setAccepting(true);
    try {
      const updated = await workApplicationsApi.accept(id, applicationId);
      await mutate(updated, { revalidate: false });
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Failed to accept application. Please try again.",
      );
    } finally {
      setAccepting(false);
    }
  };

  const reject = async () => {
    setActionError(null);
    setRejecting(true);
    try {
      const updated = await workApplicationsApi.reject(
        id,
        applicationId,
        rejectReason.trim() || undefined,
      );
      await mutate(updated, { revalidate: false });
      setRejectOpen(false);
      setRejectReason("");
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Failed to reject application. Please try again.",
      );
    } finally {
      setRejecting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-4 w-40" />
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !application) {
    return (
      <div className="space-y-4">
        <Link
          href={`/requests/${id}/applications`}
          className="text-sm text-blue-700 hover:underline"
        >
          ← Back to applications
        </Link>
        <Card>
          <CardContent className="text-sm text-red-600">
            {error instanceof ApiError && error.status === 404
              ? "This application was not found."
              : "This application was not found or could not be loaded."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const isPending = application.status === "PENDING";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/requests/${id}/applications`}
          className="text-sm text-blue-700 hover:underline"
        >
          ← Back to applications
        </Link>
        <PageHeader
          className="mt-2"
          title={
            <span className="flex items-center gap-3">
              Application review
              <ApplicationStatusBadge status={application.status} />
            </span>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Applicant</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow label="Worker" value={application.worker_id} />
            <DataRow
              label="Rating at apply time"
              value={formatScore(application.worker_rating_snapshot)}
            />
            <DataRow
              label="Applied"
              value={formatDateTime(application.applied_at)}
            />
            {application.reviewed_at && (
              <DataRow
                label="Reviewed"
                value={formatDateTime(application.reviewed_at)}
              />
            )}
            {application.rejection_reason && (
              <DataRow
                label="Rejection reason"
                value={application.rejection_reason}
              />
            )}
          </DataList>
        </CardContent>
      </Card>

      {application.cover_note && (
        <Card>
          <CardHeader>
            <CardTitle>Cover note</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-gray-700">
            {application.cover_note}
          </CardContent>
        </Card>
      )}

      <ManagerAdminGate>
        {isPending && (
          <Card>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="text-sm text-gray-600">
                Review this application. Accepting it confirms the worker for a
                slot on this shift.
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  onClick={() => setRejectOpen(true)}
                  disabled={accepting || rejecting}
                >
                  Reject
                </Button>
                <Button onClick={accept} loading={accepting} disabled={rejecting}>
                  Accept
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </ManagerAdminGate>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <Modal
        open={rejectOpen}
        onClose={() => {
          if (!rejecting) setRejectOpen(false);
        }}
        title="Reject application"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={rejecting}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={reject} loading={rejecting}>
              Reject application
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason (optional)"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="Share why this application was rejected."
        />
      </Modal>
    </div>
  );
}

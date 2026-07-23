"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useWorkApplication } from "@/hooks/useWorkApplications";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { ApiError, workApplicationsApi } from "@/lib/api";
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
  FormError,
  Modal,
  PageHeader,
  Skeleton,
  Textarea,
  TextLink,
} from "@/components/ui";

export default function ApplicationReviewPage() {
  const params = useParams<{ id: string; applicationId: string }>();
  const { id, applicationId } = params;

  const { data: application, isLoading, error, mutate } = useWorkApplication(
    id,
    applicationId,
  );

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const action = useAsyncAction();

  const accept = () =>
    action.run(() => workApplicationsApi.accept(id, applicationId), {
      key: "accept",
      onSuccess: (updated) => mutate(updated, { revalidate: false }),
      errorMessage: "Failed to accept application. Please try again.",
    });

  const reject = () =>
    action.run(
      () =>
        workApplicationsApi.reject(
          id,
          applicationId,
          rejectReason.trim() || undefined,
        ),
      {
        key: "reject",
        onSuccess: async (updated) => {
          await mutate(updated, { revalidate: false });
          setRejectOpen(false);
          setRejectReason("");
        },
        errorMessage: "Failed to reject application. Please try again.",
      },
    );

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
        <TextLink
          href={`/requests/${id}/applications`}
          className="text-sm"
        >
          ← Back to applications
        </TextLink>
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
        <TextLink
          href={`/requests/${id}/applications`}
          className="text-sm"
        >
          ← Back to applications
        </TextLink>
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
                  disabled={action.pending}
                >
                  Reject
                </Button>
                <Button
                  onClick={accept}
                  loading={action.isPending("accept")}
                  disabled={action.isPending("reject")}
                >
                  Accept
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </ManagerAdminGate>

      <FormError>{action.error}</FormError>

      <Modal
        open={rejectOpen}
        onClose={() => {
          if (!action.isPending("reject")) setRejectOpen(false);
        }}
        title="Reject application"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={action.isPending("reject")}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={reject}
              loading={action.isPending("reject")}
            >
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

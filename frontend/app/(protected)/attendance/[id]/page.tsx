"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAttendanceRecord } from "@/hooks/useAttendance";
import { attendanceApi, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { RoleGate } from "@/components/auth/RoleGate";
import { AttendanceStatusBadge } from "@/components/attendance/AttendanceStatusBadge";
import { VerificationBadge } from "@/components/attendance/VerificationBadge";
import { formatDateTime } from "@/lib/format";
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
  Select,
  Skeleton,
} from "@/components/ui";
import type { AttendanceReviewStatus } from "@/lib/types";

const REVIEW_STATUSES = [
  { value: "PRESENT", label: "Present" },
  { value: "LATE", label: "Late" },
  { value: "PARTIAL", label: "Partial" },
  { value: "ABSENT", label: "Absent" },
  { value: "EXCUSED", label: "Excused" },
];

export default function AttendanceDetailPage() {
  const params = useParams<{ id: string }>();
  const { id } = params;

  const { data: record, isLoading, error, mutate } = useAttendanceRecord(id);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [actionError, setActionError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewStatus, setReviewStatus] =
    useState<AttendanceReviewStatus>("PRESENT");
  const [markVerified, setMarkVerified] = useState(true);

  const checkOut = async () => {
    setActionError(null);
    setCheckingOut(true);
    try {
      const updated = await attendanceApi.checkOut(id);
      await mutate(updated, { revalidate: false });
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Failed to check out. Please try again.",
      );
    } finally {
      setCheckingOut(false);
    }
  };

  const submitReview = async () => {
    setActionError(null);
    setVerifying(true);
    try {
      const updated = await attendanceApi.update(id, {
        status: reviewStatus,
        ...(markVerified ? { is_verified: true } : {}),
      });
      await mutate(updated, { revalidate: false });
      setReviewOpen(false);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Failed to verify attendance. Please try again.",
      );
    } finally {
      setVerifying(false);
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

  if (error || !record) {
    return (
      <div className="space-y-4">
        <Link
          href="/attendance"
          className="text-sm text-blue-700 hover:underline"
        >
          ← Back to attendance
        </Link>
        <Card>
          <CardContent className="text-sm text-red-600">
            {error instanceof ApiError && error.status === 404
              ? "This attendance record was not found."
              : "This attendance record was not found or could not be loaded."}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Worker self check-out: only the owning worker, once checked in and not out.
  const isOwner = currentUserId != null && currentUserId === record.worker_id;
  const canCheckOut =
    isOwner && record.check_in_at !== null && record.check_out_at === null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/attendance"
          className="text-sm text-blue-700 hover:underline"
        >
          ← Back to attendance
        </Link>
        <PageHeader
          className="mt-2"
          title={
            <span className="flex items-center gap-3">
              Attendance
              <AttendanceStatusBadge status={record.status} />
              <VerificationBadge verified={record.is_verified} />
            </span>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Check-in / Check-out</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow label="Checked in" value={formatDateTime(record.check_in_at)} />
            <DataRow
              label="Checked out"
              value={formatDateTime(record.check_out_at)}
            />
            <DataRow
              label="Expected start"
              value={formatDateTime(record.expected_start)}
            />
            <DataRow
              label="Expected end"
              value={formatDateTime(record.expected_end)}
            />
            <DataRow label="Minutes late" value={record.minutes_late ?? "—"} />
            <DataRow
              label="Minutes worked"
              value={record.minutes_worked ?? "—"}
            />
          </DataList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Record</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow label="Worker" value={record.worker_id} />
            <DataRow
              label="Assignment"
              value={
                <Link
                  href={`/assignments/${record.assignment_id}`}
                  className="text-blue-700 hover:underline"
                >
                  {record.assignment_id}
                </Link>
              }
            />
            <DataRow label="Hotel" value={record.hotel_id} />
            {record.verified_by_id && (
              <DataRow label="Verified by" value={record.verified_by_id} />
            )}
            {record.verified_at && (
              <DataRow
                label="Verified at"
                value={formatDateTime(record.verified_at)}
              />
            )}
            {record.notes && <DataRow label="Notes" value={record.notes} />}
          </DataList>
        </CardContent>
      </Card>

      {canCheckOut && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              You are checked in. Record your check-out to close out this shift.
            </div>
            <Button
              onClick={checkOut}
              loading={checkingOut}
              className="shrink-0"
            >
              Check out
            </Button>
          </CardContent>
        </Card>
      )}

      <RoleGate allow={["manager", "admin", "checker"]}>
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              Review this attendance record. Set the final status and mark it
              verified.
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setReviewStatus(
                  record.status === "EXPECTED" ? "PRESENT" : record.status,
                );
                setMarkVerified(!record.is_verified);
                setReviewOpen(true);
              }}
              className="shrink-0"
            >
              {record.is_verified ? "Update review" : "Verify"}
            </Button>
          </CardContent>
        </Card>
      </RoleGate>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <Modal
        open={reviewOpen}
        onClose={() => {
          if (!verifying) setReviewOpen(false);
        }}
        title="Review attendance"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setReviewOpen(false)}
              disabled={verifying}
            >
              Cancel
            </Button>
            <Button onClick={submitReview} loading={verifying}>
              Save review
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Status"
            value={reviewStatus}
            onChange={(e) =>
              setReviewStatus(e.target.value as AttendanceReviewStatus)
            }
            options={REVIEW_STATUSES}
          />

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={markVerified}
              onChange={(e) => setMarkVerified(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Mark as verified
          </label>
        </div>
      </Modal>
    </div>
  );
}

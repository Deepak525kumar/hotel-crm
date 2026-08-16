"use client";

import { useState } from "react";
import { UserRef } from "@/components/users/UserRef";
import { useParams } from "next/navigation";
import { useAttendanceRecord } from "@/hooks/useAttendance";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useHotel } from "@/hooks/useHotels";
import { ApiError, attendanceApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { RoleGate } from "@/components/auth/RoleGate";
import { AttendanceStatusBadge } from "@/components/attendance/AttendanceStatusBadge";
import { VerificationBadge } from "@/components/attendance/VerificationBadge";
import { GeoVerificationCard } from "@/components/attendance/GeoVerificationCard";
import { formatDateTime } from "@/lib/format";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DataList,
  DataRow,
  FormError,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  TextLink,
} from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";
import type { AttendanceReviewStatus } from "@/lib/types";
import { useTranslation } from "react-i18next";

const REVIEW_STATUSES = [
  { value: "PRESENT", label: "Present" },
  { value: "LATE", label: "Late" },
  { value: "PARTIAL", label: "Partial" },
  { value: "ABSENT", label: "Absent" },
  { value: "EXCUSED", label: "Excused" },
];

export default function AttendanceDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const { id } = params;

  const { data: record, isLoading, error, mutate } = useAttendanceRecord(id);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { data: hotel } = useHotel(record?.hotel_id);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewStatus, setReviewStatus] =
    useState<AttendanceReviewStatus>("PRESENT");
  const [markVerified, setMarkVerified] = useState(true);
  const action = useAsyncAction();


  const submitReview = () =>
    action.run(
      () =>
        attendanceApi.update(id, {
          status: reviewStatus,
          ...(markVerified ? { is_verified: true } : {}),
        }),
      {
        key: "verify",
        onSuccess: async (updated) => {
          await mutate(updated, { revalidate: false });
          setReviewOpen(false);
        },
        errorMessage: "Failed to verify attendance. Please try again.",
      },
    );

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
        <BackLink href="/attendance" className="text-sm" labelKey="common.backTo.attendance" />
        <Card>
          <CardContent className="text-sm text-red-600 dark:text-red-400">
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
        <BackLink href="/attendance" className="text-sm" labelKey="common.backTo.attendance" />
        <PageHeader
          className="mt-2"
          title={
            <span className="flex items-center gap-3">
              {t("nav.attendance")}
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
            <DataRow label={t("shifts.checkedIn")} value={formatDateTime(record.check_in_at)} />
            <DataRow
              label={t("shifts.checkedOut")}
              value={formatDateTime(record.check_out_at)}
            />
            <DataRow
              label={t("attendance.expectedStart")}
              value={formatDateTime(record.expected_start)}
            />
            <DataRow
              label={t("attendance.expectedEnd")}
              value={formatDateTime(record.expected_end)}
            />
            <DataRow label={t("attendance.minutesLate")} value={record.minutes_late ?? "—"} />
            <DataRow
              label={t("attendance.minutesWorked")}
              value={record.minutes_worked ?? "—"}
            />
          </DataList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.record")}</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow
              label={t("fields.worker")}
              value={
                <UserRef userId={record.worker_id} fallback="The assigned worker" />
              }
            />
            <DataRow
              label={t("assignments.title")}
              value={
                <TextLink href={`/assignments/${record.assignment_id}`}>
                  {t("attendance.viewAssignment")}
                </TextLink>
              }
            />
            <DataRow
              label={t("fields.hotel")}
              value={
                <TextLink href={`/hotels/${record.hotel_id}`}>
                  {hotel?.name ?? "View hotel"}
                </TextLink>
              }
            />
            {record.verified_by_id && (
              <DataRow
                label={t("attendance.verifiedBy")}
                value={
                  <UserRef userId={record.verified_by_id} fallback="A manager" />
                }
              />
            )}
            {record.verified_at && (
              <DataRow
                label={t("attendance.verifiedAt")}
                value={formatDateTime(record.verified_at)}
              />
            )}
            {record.notes && <DataRow label={t("fields.notes")} value={record.notes} />}
          </DataList>
        </CardContent>
      </Card>

      <GeoVerificationCard record={record} />

      {canCheckOut && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              You are checked in. Use the{" "}
              <TextLink href={`/assignments/${record.assignment_id}`}>
                assignment page
              </TextLink>{" "}
              to check out and complete your shift.
            </div>
          </CardContent>
        </Card>
      )}

      {/* attendance/service.ts#update() has no route-level gate — authorization
          is service-only, via isScopedManagerRole() (admin/manager/
          regional_manager) plus checker's separate cross-hotel allowance. */}
      <RoleGate allow={["manager", "regional_manager", "admin", "checker"]}>
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600 dark:text-gray-300">
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

      <FormError>{action.error}</FormError>

      <Modal
        open={reviewOpen}
        onClose={() => {
          if (!action.isPending("verify")) setReviewOpen(false);
        }}
        title={t("attendance.reviewTitle")}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setReviewOpen(false)}
              disabled={action.isPending("verify")}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={submitReview} loading={action.isPending("verify")}>
              {t("attendance.saveReview")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label={t("fields.status")}
            value={reviewStatus}
            onChange={(e) =>
              setReviewStatus(e.target.value as AttendanceReviewStatus)
            }
            options={REVIEW_STATUSES}
          />

          <Checkbox
            label={t("attendance.markVerified")}
            checked={markVerified}
            onChange={(e) => setMarkVerified(e.target.checked)}
          />
        </div>
      </Modal>
    </div>
  );
}

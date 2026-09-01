"use client";

import { useEffect, useMemo, useState } from "react";
import { UserRef } from "@/components/users/UserRef";
import { useParams } from "next/navigation";
import { useAssignment } from "@/hooks/useAssignments";
import { useHotel, useUserOptions } from "@/hooks/useHotels";
import { useWorkRequest } from "@/hooks/useWorkRequests";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRoomsForCheck, useRoomsForAssignment } from "@/hooks/useRooms";
import { useAuthStore } from "@/stores/auth";
import { ApiError, assignmentsApi, attendanceApi, qualityApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { AssignmentStatusBadge } from "@/components/assignments/AssignmentStatusBadge";
import { RoomStateBadge } from "@/components/rooms/RoomStateBadge";
import { formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  FormError,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  TextLink,
} from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";
import type {
  ReworkRoundPhotos,
  InspectionChecklistItem,
  QualityVerification,
  RoomLog,
} from "@/lib/types";
import { INSPECTION_CHECKLIST_ITEMS } from "@/lib/types";
import { useTranslation } from "react-i18next";


// CRR §15: the checker uploads a photo WITH the rating. Mirrors the server's
// own limits (quality/types.ts) so an upload that would be rejected is caught
// before it leaves a hotel wifi connection. The server stays authoritative.
const MAX_VERIFICATION_PHOTOS = 6;
const MAX_VERIFICATION_PHOTO_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = "image/jpeg,image/png,image/heic,image/webp";

export default function AssignmentDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const { id } = params;
  const currentUser = useAuthStore((s) => s.user);

  const { data: assignment, isLoading, error, mutate } = useAssignment(id);
  const { data: hotel } = useHotel(assignment?.hotel_id);
  const { data: workRequest } = useWorkRequest(assignment?.job_request_id ?? assignment?.work_request_id);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);
  const action = useAsyncAction();

  // The manager's manual "rooms completed" card and its modal were removed
  // 2026-09-01 with the room log (owner decision). The count is now derived
  // from the workers' OWN per-room records — each worker logs the rooms they
  // finish (/rooms) — so a manager typing a total after the shift was a second
  // source of truth for the same fact, with nothing reconciling the two, and
  // it was the number the room-first inspection flow replaced.
  //
  // `assignmentsApi.logRoomsCompleted`/`updateRoomsCompleted` are deliberately
  // left in lib/api.ts (dormant): the backend endpoints are unchanged,
  // historical entries are still readable through `assignment.rooms_completed`,
  // and the calendar page's placement-details panel still calls both. Per-hotel
  // room activity now lives on the hotel page's "Rooms logged today" card.

  // The verification recorded in this session is held locally: the page never
  // re-reads it, so it is not restored on reload. Intentional, unchanged.
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [loggedVerification, setLoggedVerification] = useState<QualityVerification | null>(null);

  // Worker-side rework completion (CRR §14). This page can be EITHER the
  // original assignment or the rework assignment raised off it (ADR-069 makes
  // the rework its own shift), and only the latter is completable -- which is
  // what `rework_of_assignment_id` distinguishes. Self-scoped server side to
  // the assignment's own worker, so the check here is an affordance, not the
  // boundary.
  const [reworkPhotos, setReworkPhotos] = useState<File[]>([]);
  const [reworkPhotoError, setReworkPhotoError] = useState<string | null>(null);
  const submitRework = useAsyncAction();
  const isReworkShift = !!assignment?.rework_of_assignment_id;
  const isOwnShift = !!currentUser && currentUser.id === assignment?.worker_id;
  const canCompleteRework =
    isReworkShift && isOwnShift && assignment?.status !== "COMPLETED";

  const onSubmitRework = () => {
    if (reworkPhotos.length === 0) {
      // Mirrors the server's own rule (it rejects an empty upload): the photo
      // IS the completion record, so there is nothing to submit without one.
      setReworkPhotoError(t("quality.reworkPhotoRequired"));
      return;
    }
    setReworkPhotoError(null);
    submitRework.run(() => qualityApi.completeRework(id, reworkPhotos), {
      onSuccess: async () => {
        setReworkPhotos([]);
        await mutate();
      },
    });
  };

  const start = () => {
    // Workers must use the Attendance module (Bug 35): calling
    // assignmentsApi.start() as a worker returns 403. Instead, issue a
    // checkIn which syncs the assignment to IN_PROGRESS internally.
    // The assignment page is the single interaction point — workers never
    // need to navigate to /attendance to start or stop a shift.
    if (currentUser?.role === "worker") {
      action.run(
        async () => {
          // Collect geolocation if the browser supports it — required for
          // hotels that have a geofence configured (backend returns 403 if
          // a geofence is set and coordinates are absent).
          let lat: number | undefined;
          let lng: number | undefined;
          if (typeof navigator !== "undefined" && navigator.geolocation) {
            try {
              const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                  timeout: 10000,
                  maximumAge: 60000,
                })
              );
              lat = pos.coords.latitude;
              lng = pos.coords.longitude;
            } catch {
              // Location unavailable or denied — let the backend decide
              // whether that's acceptable (non-geofenced hotels proceed).
            }
          }
          return attendanceApi.checkIn({
            assignment_id: id,
            ...(lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : {}),
          });
        },
        {
          key: "start",
          onSuccess: async () => {
            await mutate();
          },
          errorMessage: "Failed to check in. Please try again.",
        }
      );
    } else {
      action.run(() => assignmentsApi.start(id), {
        key: "start",
        onSuccess: (updated) => mutate(updated, { revalidate: false }),
        errorMessage: "Failed to start assignment. Please try again.",
      });
    }
  };

  const complete = () => {
    // Workers check out via Attendance, which syncs the assignment to
    // COMPLETED via internalBypass. Managers/admin call the assignment API
    // directly.
    if (currentUser?.role === "worker") {
      action.run(
        async () => {
          // Collect geolocation — checkout geofence mirrors check-in
          // (backend enforces it on checkout too for geofenced hotels).
          let lat: number | undefined;
          let lng: number | undefined;
          if (typeof navigator !== "undefined" && navigator.geolocation) {
            try {
              const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                  timeout: 10000,
                  maximumAge: 60000,
                })
              );
              lat = pos.coords.latitude;
              lng = pos.coords.longitude;
            } catch {
              // Same as check-in: let backend decide.
            }
          }
          const records = await attendanceApi.list({ assignment_id: id, per_page: 1 });
          const record = records[0];

          // Edge case: assignment is IN_PROGRESS but no attendance record exists.
          // This happens when a manager/admin used assignmentsApi.start() directly
          // (which does not create an attendance record). We cannot call checkIn()
          // here because attendanceService.checkIn() calls
          // assignmentService.update(id, { status: IN_PROGRESS }) internally and
          // the assignment service throws ConflictError when the status is already
          // IN_PROGRESS (see assignments/service.ts:428). The admin must complete
          // this shift via the management interface.
          if (!record) {
            throw new Error(
              "This shift was started by a manager and has no check-in record. " +
              "Please ask your manager to mark this shift as complete."
            );
          }

          return attendanceApi.update(record.id, {
            check_out_at: new Date().toISOString(),
            ...(lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : {}),
          });
        },
        {
          key: "complete",
          onSuccess: async () => {
            await mutate();
          },
          errorMessage: "Failed to check out. Please try again.",
        }
      );
    } else {
      action.run(() => assignmentsApi.complete(id), {
        key: "complete",
        onSuccess: (updated) => mutate(updated, { revalidate: false }),
        errorMessage: "Failed to complete assignment. Please try again.",
      });
    }
  };

  const cancel = () =>
    action.run(
      () => assignmentsApi.cancel(id, cancelReason.trim() || undefined),
      {
        key: "cancel",
        onSuccess: async (updated) => {
          await mutate(updated, { revalidate: false });
          setCancelOpen(false);
          setCancelReason("");
        },
        errorMessage: "Failed to cancel assignment. Please try again.",
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

  if (error || !assignment) {
    return (
      <div className="space-y-4">
        <BackLink href="/assignments" className="text-sm" labelKey="common.backTo.assignments" />
        <Card>
          <CardContent className="text-sm text-red-600 dark:text-red-400">
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
  // Same eligible states as cancel -- reassign is a managerial alternative
  // to cancel-then-recreate, not available on a terminal assignment.
  const canReassign = canCancel;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <BackLink href="/assignments" className="text-sm" labelKey="common.backTo.assignments" />
        <PageHeader
          className="mt-2"
          title={
            <span className="flex items-center gap-3">
              {t("assignments.title")}
              <AssignmentStatusBadge status={assignment.status} />
            </span>
          }
        />
      </div>

      {/* The worker's own half of CRR §14, previously app-only: this shift IS
          the rework (ADR-069 raises it as its own assignment), so the worker
          who owns it uploads the fix here and marks it done. Placed above the
          details card because on a rework shift it is the only thing the
          worker came to this page to do. */}
      {canCompleteRework && (
        <Card>
          <CardHeader>
            <CardTitle>{t("quality.reworkTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label
              htmlFor="rework-photos"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("quality.photos")}
            </label>
            <input
              id="rework-photos"
              type="file"
              accept={ACCEPTED_PHOTO_TYPES}
              multiple
              // Same `capture` reasoning as the inspection input below: opens
              // the camera on a phone, a file picker at a desk.
              capture="environment"
              onChange={(e) => {
                setReworkPhotoError(null);
                setReworkPhotos(Array.from(e.target.files ?? []));
              }}
              className="block w-full text-sm"
            />
            {reworkPhotos.length > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {reworkPhotos.map((p) => p.name).join(", ")}
              </p>
            )}
            <FormError>{reworkPhotoError ?? submitRework.error}</FormError>
            <Button
              onClick={onSubmitRework}
              loading={submitRework.pending}
              disabled={submitRework.pending}
            >
              {t("quality.markDone")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("common.details")}</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow
              label={t("fields.worker")}
              value={
                <UserRef userId={assignment.worker_id} fallback="The assigned worker" />
              }
            />
            <DataRow
              label={t("fields.hotel")}
              value={
                <TextLink href={`/hotels/${assignment.hotel_id}`}>
                  {hotel?.name ?? "View hotel"}
                </TextLink>
              }
            />
            <DataRow
              label={t("assignments.source")}
              value={
                assignment.job_request_id ? (
                  <TextLink href={`/requests/broadcasts/${assignment.job_request_id}`}>
                    {t("assignments.broadcastEpic9")}
                  </TextLink>
                ) : assignment.work_request_id ? (
                  <TextLink href={`/requests/${assignment.work_request_id}`}>
                    {t("assignments.directRequestLegacy")}
                  </TextLink>
                ) : (
                  <span className="text-gray-500">Calendar Placement (Direct Schedule)</span>
                )
              }
            />
            {(assignment.job_request_id || assignment.work_request_id) && (
              <DataRow
                label={t("assignments.requestedPosition")}
                value={workRequest?.position ?? "—"}
              />
            )}
            <DataRow
              label={t("assignments.shift")}
              value={
                workRequest
                  ? `${workRequest.shift_date} · ${workRequest.shift_start_time}–${workRequest.shift_end_time}`
                  : "—"
              }
            />
            <DataRow
              label={t("assignments.assignedBy")}
              value={
                <UserRef userId={assignment.assigned_by_id} fallback="A manager" />
              }
            />
            <DataRow
              label={t("status.confirmed")}
              value={formatDateTime(assignment.confirmed_at)}
            />
            {assignment.started_at && (
              <DataRow
                label={t("assignments.started")}
                value={formatDateTime(assignment.started_at)}
              />
            )}
            {assignment.completed_at && (
              <DataRow
                label={t("status.completed")}
                value={formatDateTime(assignment.completed_at)}
              />
            )}
            {assignment.cancelled_at && (
              <DataRow
                label={t("status.cancelled")}
                value={formatDateTime(assignment.cancelled_at)}
              />
            )}
            {assignment.cancellation_reason && (
              <DataRow
                label={t("requests.cancellationReason")}
                value={assignment.cancellation_reason}
              />
            )}
          </DataList>
        </CardContent>
      </Card>

      {(canStart || canComplete || canCancel) && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Manage this assignment&apos;s status. Transitions follow the
              shift lifecycle.
            </div>
            <div className="flex shrink-0 gap-2">
              {canReassign && (
                <RoleGate allow={["admin", "manager", "regional_manager"]}>
                  <Button
                    variant="outline"
                    onClick={() => setReassignOpen(true)}
                    disabled={action.pending}
                  >
                    {t("common.reassign")}
                  </Button>
                </RoleGate>
              )}
              {canCancel && (
                <Button
                  variant="outline"
                  onClick={() => setCancelOpen(true)}
                  disabled={action.pending}
                >
                  {t("common.cancel")}
                </Button>
              )}
              {canStart && (
                <Button
                  onClick={start}
                  loading={action.isPending("start")}
                  disabled={action.isPending("cancel")}
                >
                  {currentUser?.role === "worker" ? "Check in" : "Start shift"}
                </Button>
              )}
              {canComplete && (
                <Button
                  onClick={complete}
                  loading={action.isPending("complete")}
                  disabled={action.isPending("cancel")}
                >
                  {currentUser?.role === "worker" ? "Check out" : "Complete"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* The manager's "rooms completed" entry card stood here until
          2026-09-01. See the comment beside this page's state declarations for
          why it is gone and where the number comes from now.

          What stands here instead (2026-09-02): the rooms THIS shift actually
          logged. Retiring the manual count left this page with no room
          information at all -- the replacement view is per-hotel and
          today-only, so a manager opening a shift, and any past shift at all,
          showed nothing. */}
      <ShiftRoomsCard assignmentId={id} />

      {/*
        quality:write (backend/src/config/constants.ts ROLE_PERMISSIONS) is
        held by ADMIN and CHECKER only — MANAGER/REGIONAL_MANAGER hold
        quality:read, not quality:write. "manager" is deliberately excluded
        here even though it's included for rooms-completed above (a
        different action, gated by role only, not this permission token).
      */}
      <RoleGate allow={["admin", "checker"]}>
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            {/* The room is the subject of the check -- every inspection now
                targets one specific room the worker logged -- but this line
                reported only a score and a status, so the one fact that says
                WHICH room was inspected was captured, stored and then never
                shown here. */}
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {loggedVerification
                ? `${t("quality.roomLabel")} ${loggedVerification.room_number} — score ${loggedVerification.score} (${loggedVerification.status}).`
                : "Verify the completed work for this assignment."}
            </div>
            {loggedVerification ? (
              <Badge
                tone={
                  loggedVerification.status === "PASSED"
                    ? "success"
                    : loggedVerification.status === "NEEDS_REWORK"
                      ? "warning"
                      : "danger"
                }
              >
                {loggedVerification.status}
              </Badge>
            ) : (
              <Button
                variant="outline"
                onClick={() => setVerificationOpen(true)}
                className="shrink-0"
              >
                {t("common.verify")}
              </Button>
            )}
          </CardContent>

          {loggedVerification && (
            <CardContent className="border-t pt-4">
              <VerificationEvidence verificationId={loggedVerification.id} />
            </CardContent>
          )}

          {/* CRR §14: rework is assigned to a specific worker after a failed
              inspection. Only offered once a verification exists and it did
              NOT pass -- the backend rejects rework on a PASSED inspection,
              so offering it would be a button that always errors. */}
          {loggedVerification && loggedVerification.status !== "PASSED" && (
            <CardContent className="flex items-center justify-between gap-4 border-t pt-4">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {loggedVerification.rework_completed_at
                  ? t("quality.reworkDone", {
                      when: formatDateTime(loggedVerification.rework_completed_at),
                    })
                  : loggedVerification.rework_required
                    ? t("quality.reworkPending")
                    : t("quality.reworkNotes")}
              </div>
              {!loggedVerification.rework_required && (
                <Button
                  variant="outline"
                  onClick={() => setReworkOpen(true)}
                  className="shrink-0"
                >
                  {t("quality.assignRework")}
                </Button>
              )}
            </CardContent>
          )}
        </Card>

        {/* The separate "Rate worker" card was removed 2026-08-29 with the
            Rating model. One visit wrote two records carrying the same score
            and the same photographs; the checklist that made the rating
            distinct now travels with the verification above, so this page has
            one inspection action instead of two that could disagree. */}
      </RoleGate>

      <FormError>{action.error}</FormError>

      <Modal
        open={cancelOpen}
        onClose={() => {
          if (!action.isPending("cancel")) setCancelOpen(false);
        }}
        title={t("assignments.cancelTitle")}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={action.isPending("cancel")}
            >
              {t("assignments.keepAssignment")}
            </Button>
            <Button
              variant="danger"
              onClick={cancel}
              loading={action.isPending("cancel")}
            >
              {t("assignments.cancelTitle")}
            </Button>
          </>
        }
      >
        <Textarea
          label={t("fields.reasonOptional")}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder={t("assignments.cancelReasonPlaceholder")}
        />
      </Modal>

      <ReassignModal
        assignmentId={id}
        hotelId={assignment.hotel_id}
        currentWorkerId={assignment.worker_id}
        open={reassignOpen}
        onClose={() => setReassignOpen(false)}
        onReassigned={(updated) => mutate(updated, { revalidate: false })}
      />

      <CreateVerificationModal
        assignmentId={id}
        hotelId={assignment.hotel_id}
        workerId={assignment.worker_id}
        open={verificationOpen}
        onClose={() => setVerificationOpen(false)}
        onCreated={setLoggedVerification}
      />

      {loggedVerification && (
        <AssignReworkModal
          verificationId={loggedVerification.id}
          open={reworkOpen}
          onClose={() => setReworkOpen(false)}
          onAssigned={() =>
            // Reflect the new state locally rather than refetching: the only
            // field the card reads is rework_required, and the server has
            // already committed it.
            setLoggedVerification((v) => (v ? { ...v, rework_required: true } : v))
          }
        />
      )}

    </div>
  );
}

function ReassignModal({
  assignmentId,
  hotelId,
  currentWorkerId,
  open,
  onClose,
  onReassigned,
}: {
  assignmentId: string;
  hotelId: string;
  currentWorkerId: string;
  open: boolean;
  onClose: () => void;
  onReassigned: (updated: import("@/lib/types").Assignment) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const { users: workers, isLoading: workersLoading } = useUserOptions({
    role: "worker",
    hotel_id: hotelId,
    search: debouncedSearch || undefined,
    limit: 20,
  });
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const reassign = useAsyncAction();

  const eligibleWorkers = workers.filter((w) => w.id !== currentWorkerId);

  const reset = () => {
    setSearch("");
    setSelectedWorkerId("");
  };

  const handleClose = () => {
    if (reassign.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    if (!selectedWorkerId) return;
    reassign.run(() => assignmentsApi.reassign(assignmentId, selectedWorkerId), {
      onSuccess: (result) => {
        onReassigned(result.old_assignment);
        reset();
        onClose();
      },
      errorMessage: "Failed to reassign this assignment. Please try again.",
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("assignments.reassignTitle")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={reassign.pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSubmit} loading={reassign.pending} disabled={!selectedWorkerId}>
            {t("common.reassign")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          The current assignment is marked reassigned; a new confirmed assignment is created for
          the selected worker at the same hotel and day.
        </p>
        <Input
          label={t("assignments.searchWorkersAtHotel")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search.byNameOrEmail")}
        />
        <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-800">
          {workersLoading ? (
            <div className="p-3 text-sm text-gray-400 dark:text-gray-500">Searching…</div>
          ) : eligibleWorkers.length === 0 ? (
            <div className="p-3 text-sm text-gray-400 dark:text-gray-500">{t("assignments.noEligibleWorkers")}</div>
          ) : (
            eligibleWorkers.map((w) => {
              const label = `${w.first_name} ${w.last_name}`;
              const selected = selectedWorkerId === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setSelectedWorkerId(w.id)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${
                    selected ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400" : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  <span className="truncate">{label}</span>
                  <span className="truncate text-xs text-gray-400 dark:text-gray-500">{w.email}</span>
                </button>
              );
            })
          )}
        </div>
        <FormError>{reassign.error}</FormError>
      </div>
    </Modal>
  );
}

// LogRoomsCompletedModal lived here until 2026-09-01. It typed a single
// post-shift total; the room log replaced it with the workers' own per-room
// records, which is also what the inspection below is now driven from.

/**
 * CRR §14: the checker assigns rework to the worker who did the room.
 *
 * Notes are mandatory -- they are the message the worker actually receives
 * (assignRework uses them as the notification body), so an empty note would
 * push "Rework required" with no indication of what to redo.
 */
/**
 * CRR §14/§15: the photo evidence attached to an inspection.
 *
 * Fetched on demand, not with the verification: presigned URLs expire in 15
 * minutes, so anything cached alongside the record would be dead by the time
 * it was rendered. Without this the photos were write-only -- uploaded,
 * stored, and impossible to look at.
 */
/**
 * The rooms this shift logged, with the state of each.
 *
 * Reads the assignment-scoped endpoint rather than filtering a day-scoped one:
 * a shift being looked at is very often not today's, and the picker read that
 * the inspection modal uses excludes `worker` outright, while the worker whose
 * shift this is has every reason to see their own list here.
 *
 * Renders nothing at all when the shift logged no rooms -- an empty card on
 * every admin-created or not-yet-started shift would be noise, and the absence
 * of rooms is not information anyone is looking for on this page.
 */
function ShiftRoomsCard({ assignmentId }: { assignmentId: string }) {
  const { t } = useTranslation();
  const { data, error } = useRoomsForAssignment(assignmentId);
  const rooms = data?.rooms ?? [];

  // A 403 here is ordinary, not a failure worth showing: the endpoint is
  // scoped to whoever may see the shift, and this card is rendered for
  // everyone who can open the page.
  if (error || rooms.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("rooms.todayTitle")} · {rooms.length}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-2">
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rooms.map((room) => (
            <li key={room.id} className="flex items-center justify-between gap-4 py-2">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {room.room_number}
              </span>
              <RoomStateBadge state={room.state} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function VerificationEvidence({ verificationId }: { verificationId: string }) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<{ key: string; url: string | null }[] | null>(null);
  const [rounds, setRounds] = useState<ReworkRoundPhotos[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void qualityApi
      .verificationPhotos(verificationId)
      .then((r) => {
        if (cancelled) return;
        setPhotos(r.photos);
        // Optional on the wire, so a check with no rework renders no round
        // sections rather than throwing.
        setRounds(r.rework_rounds ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [verificationId]);

  // An inspection with no photos is normal (they are optional), so render
  // nothing rather than an empty state that implies something is missing.
  // Rounds count too: a check may carry no checker photos but still have
  // rework evidence worth showing.
  if (failed || !photos || (photos.length === 0 && rounds.length === 0)) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {t("quality.evidence")}
      </p>
      <div className="flex flex-wrap gap-2">
        {photos.map((photo) =>
          photo.url ? (
            // Opens full size in a new tab: these are room photos a checker
            // needs to actually inspect, not decoration.
            <a key={photo.key} href={photo.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- the src
                  is a short-lived presigned S3 URL, not a static asset, so
                  next/image's optimiser cannot help and would only add a
                  server round-trip against an expiring URL. */}
              <img
                src={photo.url}
                alt={t("quality.evidence")}
                className="h-20 w-20 rounded-md border border-gray-200 object-cover dark:border-gray-800"
              />
            </a>
          ) : (
            // url === null means storage is unconfigured. Shown as a broken
            // tile rather than hidden, so a misconfigured bucket does not look
            // like an inspection that never had evidence.
            <div
              key={photo.key}
              className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-gray-300 text-center text-[10px] text-gray-400 dark:border-gray-700"
            >
              {t("quality.photoUnavailable")}
            </div>
          ),
        )}
      </div>

      {/* One block per rework attempt (2026-08-30). The worker's proof of a fix
          used to be appended into the array above, so a manager reviewing a
          shift saw one flat strip in which the checker's original photographs
          and the worker's corrections were indistinguishable. */}
      {rounds.map((round) => (
        <div key={round.id} className="space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {t("quality.reworkRoundTitle", { number: round.round_number })}
            </p>
            <span
              className={
                round.completed_at
                  ? "text-xs text-green-700 dark:text-green-400"
                  : "text-xs text-amber-700 dark:text-amber-400"
              }
            >
              {round.completed_at
                ? t("quality.reworkCompleted")
                : t("quality.reworkAwaitingWorker")}
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">{round.notes}</p>
          {round.photos.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {round.photos.map((photo) =>
                photo.url ? (
                  <a key={photo.key} href={photo.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- presigned URL */}
                    <img
                      src={photo.url}
                      alt=""
                      className="h-20 w-20 rounded object-cover"
                    />
                  </a>
                ) : (
                  <div
                    key={photo.key}
                    className="flex h-20 w-20 items-center justify-center rounded bg-gray-200 p-1 text-center text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                  >
                    {t("quality.photoUnavailable")}
                  </div>
                )
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {round.completed_at
                ? t("quality.reworkNoRoundPhotos")
                : t("quality.reworkAwaitingPhotos")}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function AssignReworkModal({
  verificationId,
  open,
  onClose,
  onAssigned,
}: {
  verificationId: string;
  open: boolean;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const assign = useAsyncAction();

  const handleClose = () => {
    if (assign.pending) return;
    setNotes("");
    setFieldError(null);
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    if (!notes.trim()) {
      setFieldError(t("quality.reworkNotesRequired"));
      return;
    }
    assign.run(
      () => qualityApi.assignRework({ verification_id: verificationId, notes: notes.trim() }),
      {
        onSuccess: () => {
          onAssigned();
          setNotes("");
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("quality.assignRework")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={assign.pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSubmit} loading={assign.pending}>
            {t("quality.assignRework")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          label={t("quality.reworkNotes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {fieldError && (
          <p className="text-sm text-red-600 dark:text-red-400">{fieldError}</p>
        )}
        <FormError>{assign.error}</FormError>
      </div>
    </Modal>
  );
}

/**
 * Sentinel for "room not on the list". A `<select>` value must be a string, and
 * a sentinel keeps the fallback reachable from the same control the rooms are
 * in -- a checker who cannot find the room should not have to work out that
 * some other affordance exists.
 */
const MANUAL_ROOM = "__manual__";

/**
 * A room option's visible text. Room number first because that is what the
 * checker is standing in front of; the worker follows because the room is what
 * identifies them here, and two workers can be on one floor.
 *
 * Deliberately untranslated data only -- an `<option>` cannot carry markup, so
 * anything more structured than this would have to be faked with punctuation.
 */
function roomOptionLabel(room: RoomLog): string {
  return [room.room_number, room.worker_name].filter(Boolean).join(" · ");
}

/**
 * The inspection write, room-first since 2026-09-01 (owner decision).
 *
 * The room number used to be free text typed from memory: it was tied to
 * nothing, so a typo produced a check against a room nobody had cleaned, and
 * the worker's own record of that room stayed unlinked forever. Now the
 * checker picks one of the rooms the WORKER logged, and the room supplies the
 * assignment, the worker and the room number -- which is why the request below
 * uses the selected room's ids rather than this page's assignment.
 *
 * Posts to `/quality/inspections` (qualityApi.recordInspection), NOT
 * `/quality/verifications`: only the former accepts `room_log_id`, and it is
 * that id which links the check back to the worker's room. The other endpoint's
 * schema is not `.strict()`, so the id would have been silently dropped and the
 * room would still read "awaiting check" with an inspection sitting against it.
 * `outcome: "complete"` keeps this page's existing two-step flow intact -- the
 * status stays score-derived, and rework is still assigned afterwards from the
 * card above (Assign rework), rather than turning this modal into a decision
 * screen it has never been.
 */
function CreateVerificationModal({
  assignmentId,
  hotelId,
  workerId,
  open,
  onClose,
  onCreated,
}: {
  assignmentId: string;
  hotelId: string;
  workerId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (verification: QualityVerification) => void;
}) {
  const { t } = useTranslation();
  const [score, setScore] = useState("");
  const [notes, setNotes] = useState("");
  // The picked room log id, or MANUAL_ROOM for the typed-room fallback.
  const [selection, setSelection] = useState("");
  // Only used on the fallback path: a room the worker never logged has no
  // record to link to, and a skipped room must stay inspectable.
  const [roomNumber, setRoomNumber] = useState("");
  // TREQ-005: one entry per confirmed checklist item, driven off the shared
  // constant rather than hand-declared hooks -- adding or removing an item is
  // then a one-line change and cannot leave the form and the API disagreeing.
  //
  // Moved here from the separate rating modal when Rating was merged into
  // QualityVerification (2026-08-29). Without it the web would have lost the
  // ability to record a checklist at all, which the mobile app still can.
  const [criteria, setCriteria] = useState<Partial<Record<InspectionChecklistItem, string>>>({});
  const [photos, setPhotos] = useState<File[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const create = useAsyncAction();

  // Fetched only while the modal is open, and narrowed to THIS hotel. The
  // hotel_id can only narrow what the caller may already see (an out-of-scope
  // hotel answers 403, not an empty list), and scope itself is resolved
  // server-side from the caller -- a checker sees only hotels they are rostered
  // at today. Nothing here is filtered client-side.
  const { data: picker, isLoading: pickerLoading, error: pickerError } = useRoomsForCheck(
    open ? hotelId : null,
  );

  const rooms = useMemo(
    () => [
      ...(picker?.awaiting_check ?? []),
      ...(picker?.reworked ?? []),
      ...(picker?.already_checked ?? []),
    ],
    [picker],
  );
  const selectedRoom = rooms.find((r) => r.id === selection);
  // With nothing to pick, the fallback IS the form rather than an extra choice
  // to make first -- including when the picker itself failed to load, so a 403
  // or a network error never leaves a checker unable to record anything.
  const pickerUnavailable = Boolean(pickerError) || (!pickerLoading && rooms.length === 0);
  const manualRoom = selection === MANUAL_ROOM || pickerUnavailable;

  const reset = () => {
    setScore("");
    setNotes("");
    setSelection("");
    setRoomNumber("");
    setCriteria({});
    setPhotos([]);
    setFieldError(null);
  };

  // Validated here as well as server-side. The server is authoritative, but a
  // 10 MB upload that is going to be rejected should not be sent at all --
  // checkers are on hotel wifi and phone cameras produce large files.
  const onPickPhotos = (picked: FileList | null) => {
    if (!picked) return;
    setFieldError(null);
    const next = [...photos, ...Array.from(picked)];
    if (next.length > MAX_VERIFICATION_PHOTOS) {
      setFieldError(t("quality.tooManyPhotos", { max: MAX_VERIFICATION_PHOTOS }));
      return;
    }
    const tooBig = next.find((f) => f.size > MAX_VERIFICATION_PHOTO_BYTES);
    if (tooBig) {
      setFieldError(
        t("quality.photoTooLarge", {
          name: tooBig.name,
          mb: Math.floor(MAX_VERIFICATION_PHOTO_BYTES / (1024 * 1024)),
        }),
      );
      return;
    }
    setPhotos(next);
  };

  const handleClose = () => {
    if (create.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    // Checked before the score and before any upload: a missing room is the
    // cheapest failure to surface.
    const submittedRoom = selectedRoom ? selectedRoom.room_number : roomNumber.trim();
    if (submittedRoom === "") {
      setFieldError(t("quality.roomRequired"));
      return;
    }
    const parsed = Number(score);
    if (score === "" || !Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      setFieldError(t("assignments.scoreWholeNumber"));
      return;
    }

    // Each checklist entry is optional, but one that IS filled in must be a
    // whole 0-100 -- the server rejects anything else, and finding that out
    // after a multi-megabyte photo upload is a poor trade.
    const criteriaScores: Partial<Record<InspectionChecklistItem, number>> = {};
    for (const [item, raw] of Object.entries(criteria)) {
      if (raw === undefined || raw === "") continue;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        setFieldError(t("quality.checklistItemRange"));
        return;
      }
      criteriaScores[item as InspectionChecklistItem] = value;
    }

    // The server refuses a photoless inspection (CRR §15: the evidence is what
    // justifies the whole rating/rework/dispute loop). Caught here so the
    // refusal does not arrive after an upload attempt on hotel wifi.
    if (photos.length === 0) {
      setFieldError(t("quality.photoRequired"));
      return;
    }

    create.run(
      () =>
        qualityApi.recordInspection(
          {
            // The ROOM is the authority on whose work this is: a room logged
            // by another worker at this hotel carries its own assignment and
            // worker, and sending this page's instead would attribute the
            // check -- and any rework -- to the wrong person. The server
            // cross-checks all four fields and rejects a mismatch.
            assignment_id: selectedRoom ? selectedRoom.assignment_id : assignmentId,
            worker_id: selectedRoom ? selectedRoom.worker_id : workerId,
            room_number: submittedRoom,
            score: parsed,
            comment: notes.trim() || undefined,
            criteria_scores: criteriaScores,
            outcome: "complete",
            ...(selectedRoom ? { room_log_id: selectedRoom.id } : {}),
          },
          photos,
        ),
      {
        onSuccess: (result) => {
          onCreated(result.verification);
          reset();
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("assignments.verifyTitle")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={create.pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            {t("common.verify")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {pickerLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          !pickerUnavailable && (
            <>
              {/* Grouped by what can be done with each room, and empty groups
                  are omitted rather than rendered as bare labels: on a normal
                  shift two of the three are empty. Already-checked rooms are
                  listed rather than hidden so a room can be re-checked
                  deliberately -- the server treats that as a new check and
                  re-points the room at it. */}
              <Select
                label={t("quality.roomLabel")}
                placeholder={t("rooms.check.title")}
                value={selection}
                onChange={(e) => setSelection(e.target.value)}
              >
                {picker && picker.awaiting_check.length > 0 && (
                  <optgroup label={t("rooms.state.awaitingCheck")}>
                    {picker.awaiting_check.map((room) => (
                      <option key={room.id} value={room.id}>
                        {roomOptionLabel(room)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {picker && picker.reworked.length > 0 && (
                  <optgroup label={t("rooms.check.reworkedTitle")}>
                    {picker.reworked.map((room) => (
                      <option key={room.id} value={room.id}>
                        {roomOptionLabel(room)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {picker && picker.already_checked.length > 0 && (
                  <optgroup label={t("rooms.check.checkedTitle")}>
                    {picker.already_checked.map((room) => (
                      <option key={room.id} value={room.id}>
                        {roomOptionLabel(room)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {/* Kept in the same control, not hidden behind a link: a worker
                    can forget to log a room, and a skipped room must still be
                    inspectable. That path sends no room_log_id. */}
                <option value={MANUAL_ROOM}>{t("rooms.check.notListed")}</option>
              </Select>

              {/* The worker is DERIVED from the room, and may not be the worker
                  on this page's assignment -- so it is shown rather than
                  assumed. */}
              {selectedRoom && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("fields.worker")}:{" "}
                  {selectedRoom.worker_name ?? t("quality.workerUnavailable")}
                </p>
              )}
            </>
          )
        )}

        {manualRoom && (
          <>
            {pickerUnavailable && !pickerError && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t("rooms.check.empty")}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("rooms.check.emptyBody")}
                </p>
              </div>
            )}
            {pickerError && (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("common.loadFailed")}</p>
            )}
            <Input
              label={t("quality.roomTitle")}
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              placeholder={t("quality.roomPlaceholder")}
              maxLength={64}
            />
          </>
        )}

        <Input
          label={t("fields.score0to100")}
          type="number"
          min={0}
          max={100}
          step={1}
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />

        {/* TREQ-005 checklist. Moved here from the separate rating modal
            when the two records merged (2026-08-29); every item is
            optional. */}
          {INSPECTION_CHECKLIST_ITEMS.map((item) => (
            <Input
              key={item}
              label={t(`checklist.${item}`)}
              type="number"
              min={0}
              max={100}
              step={1}
              value={criteria[item] ?? ""}
              onChange={(e) =>
                setCriteria((prev) => ({ ...prev, [item]: e.target.value }))
              }
            />
          ))}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("assignments.scoreDerivedHint")}
        </p>

        {/* CRR §15: photo evidence accompanies the rating. Optional at the
            transport layer, so a checker without a photo is not blocked. */}
        <div className="space-y-2">
          {/* Associated with `htmlFor`/`id`: this label sat next to the input
              with nothing tying the two together, so a screen reader
              announced an unlabelled file control and clicking the text did
              not open the picker. */}
          <label htmlFor="verification-photos" className="block text-sm font-medium">
            {t("quality.photos")}
          </label>
          <input
            id="verification-photos"
            type="file"
            accept={ACCEPTED_PHOTO_TYPES}
            multiple
            // `capture` is honoured on mobile browsers and ignored on desktop,
            // so the same control opens the camera in a corridor and a file
            // picker at a desk.
            capture="environment"
            onChange={(e) => onPickPhotos(e.target.files)}
            className="block w-full text-sm"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("quality.photosHint", { max: MAX_VERIFICATION_PHOTOS })}
          </p>
          {photos.length > 0 && (
            <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
              {photos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                    className="shrink-0 text-red-600 hover:underline dark:text-red-400"
                  >
                    {t("common.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Textarea
          label={t("fields.notesOptional")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={3}
        />
        <FormError>{fieldError ?? create.error}</FormError>
      </div>
    </Modal>
  );
}

// CreateRatingModal was removed 2026-08-29 with the Rating model. Its
// checklist and comment now live in CreateVerificationModal above, which
// writes the single record an inspection produces.


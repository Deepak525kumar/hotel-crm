"use client";

import { useState } from "react";
import { UserRef } from "@/components/users/UserRef";
import { useParams } from "next/navigation";
import { useAssignment } from "@/hooks/useAssignments";
import { useHotel, useUserOptions } from "@/hooks/useHotels";
import { useWorkRequest } from "@/hooks/useWorkRequests";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAuthStore } from "@/stores/auth";
import { ApiError, assignmentsApi, attendanceApi, qualityApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { AssignmentStatusBadge } from "@/components/assignments/AssignmentStatusBadge";
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
  Skeleton,
  Textarea,
  TextLink,
} from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";
import type { QualityVerification, Rating, RoomsCompletedEntry } from "@/lib/types";
import { useTranslation } from "react-i18next";

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

  // No GET endpoint exists for rooms-completed entries (ADR-028) — the
  // logged entry is only ever known from this page's own POST response, not
  // re-fetchable on reload. Session-local only, intentionally.
  const [roomsCompletedOpen, setRoomsCompletedOpen] = useState(false);
  const [loggedRoomsCompleted, setLoggedRoomsCompleted] = useState<RoomsCompletedEntry | null>(
    null,
  );

  // Same shape as rooms-completed above: no GET endpoint exists for either
  // (quality/routes.ts has no read route beyond the leaderboard), so both
  // are session-local only, not re-fetchable on reload.
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [loggedVerification, setLoggedVerification] = useState<QualityVerification | null>(null);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [loggedRating, setLoggedRating] = useState<Rating | null>(null);

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

      {/* rooms-completed route now includes regional_manager (ADR-030 §3
          C-24, staffing:write) alongside admin/manager. */}
      {assignment.status === "COMPLETED" && (
        <RoleGate allow={["admin", "manager", "regional_manager"]}>
          <Card>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {(loggedRoomsCompleted ?? assignment.rooms_completed)
                  ? `Logged ${(loggedRoomsCompleted ?? assignment.rooms_completed)!.rooms_completed} rooms completed.`
                  : "Log the rooms completed count for this assignment."}
              </div>
              {(loggedRoomsCompleted ?? assignment.rooms_completed) ? (
                <Badge tone="success">{t("status.logged")}</Badge>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setRoomsCompletedOpen(true)}
                  className="shrink-0"
                >
                  {t("assignments.logRoomsCompletedTitle")}
                </Button>
              )}
            </CardContent>
          </Card>
        </RoleGate>
      )}

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
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {loggedVerification
                ? `Verified — score ${loggedVerification.score} (${loggedVerification.status}).`
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
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {loggedRating
                ? `Rated — score ${loggedRating.score}/100.`
                : "Rate the worker's performance for this assignment."}
            </div>
            {loggedRating ? (
              <Badge tone="success">{t("status.rated")}</Badge>
            ) : (
              <Button variant="outline" onClick={() => setRatingOpen(true)} className="shrink-0">
                {t("common.rate")}
              </Button>
            )}
          </CardContent>
        </Card>
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

      <LogRoomsCompletedModal
        assignmentId={id}
        open={roomsCompletedOpen}
        onClose={() => setRoomsCompletedOpen(false)}
        onLogged={setLoggedRoomsCompleted}
      />

      <CreateVerificationModal
        assignmentId={id}
        open={verificationOpen}
        onClose={() => setVerificationOpen(false)}
        onCreated={setLoggedVerification}
      />

      <CreateRatingModal
        assignmentId={id}
        workerId={assignment.worker_id}
        open={ratingOpen}
        onClose={() => setRatingOpen(false)}
        onCreated={setLoggedRating}
      />
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

function LogRoomsCompletedModal({
  assignmentId,
  open,
  onClose,
  onLogged,
}: {
  assignmentId: string;
  open: boolean;
  onClose: () => void;
  onLogged: (entry: RoomsCompletedEntry) => void;
}) {
  const { t } = useTranslation();
  const [roomsCompleted, setRoomsCompleted] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const log = useAsyncAction();

  const reset = () => {
    setRoomsCompleted("");
    setNotes("");
    setFieldError(null);
  };

  const handleClose = () => {
    if (log.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    const parsed = Number(roomsCompleted);
    if (roomsCompleted === "" || !Number.isInteger(parsed) || parsed < 0) {
      setFieldError(t("assignments.roomsWholeNumber"));
      return;
    }

    log.run(
      () =>
        assignmentsApi.logRoomsCompleted(assignmentId, {
          rooms_completed: parsed,
          notes: notes.trim() || undefined,
        }),
      {
        onSuccess: (entry) => {
          onLogged(entry);
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
      title={t("assignments.logRoomsCompletedTitle")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={log.pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSubmit} loading={log.pending}>
            {t("assignments.log")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label={t("assignments.roomsCompleted")}
          type="number"
          min={0}
          step={1}
          value={roomsCompleted}
          onChange={(e) => setRoomsCompleted(e.target.value)}
        />
        <Textarea
          label={t("fields.notesOptional")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={3}
        />
        <FormError>{fieldError ?? log.error}</FormError>
      </div>
    </Modal>
  );
}

function CreateVerificationModal({
  assignmentId,
  open,
  onClose,
  onCreated,
}: {
  assignmentId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (verification: QualityVerification) => void;
}) {
  const { t } = useTranslation();
  const [score, setScore] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const create = useAsyncAction();

  const reset = () => {
    setScore("");
    setNotes("");
    setFieldError(null);
  };

  const handleClose = () => {
    if (create.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    const parsed = Number(score);
    if (score === "" || !Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      setFieldError(t("assignments.scoreWholeNumber"));
      return;
    }

    create.run(
      () =>
        qualityApi.createVerification({
          assignment_id: assignmentId,
          score: parsed,
          notes: notes.trim() || undefined,
        }),
      {
        onSuccess: (verification) => {
          onCreated(verification);
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
        <Input
          label={t("fields.score0to100")}
          type="number"
          min={0}
          max={100}
          step={1}
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("assignments.scoreDerivedHint")}
        </p>
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

function CreateRatingModal({
  assignmentId,
  workerId,
  open,
  onClose,
  onCreated,
}: {
  assignmentId: string;
  workerId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (rating: Rating) => void;
}) {
  const { t } = useTranslation();
  const [score, setScore] = useState("");
  const [comment, setComment] = useState("");
  const [punctuality, setPunctuality] = useState("");
  const [quality, setQuality] = useState("");
  const [attitude, setAttitude] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const create = useAsyncAction();

  const reset = () => {
    setScore("");
    setComment("");
    setPunctuality("");
    setQuality("");
    setAttitude("");
    setFieldError(null);
  };

  const handleClose = () => {
    if (create.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    const parsed = Number(score);
    if (score === "" || !Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      setFieldError(t("assignments.scoreWholeNumber"));
      return;
    }

    const criteriaScores: { punctuality?: number; quality?: number; attitude?: number } = {};
    if (punctuality !== "") criteriaScores.punctuality = Number(punctuality);
    if (quality !== "") criteriaScores.quality = Number(quality);
    if (attitude !== "") criteriaScores.attitude = Number(attitude);

    create.run(
      () =>
        qualityApi.createRating({
          assignment_id: assignmentId,
          worker_id: workerId,
          score: parsed,
          comment: comment.trim() || undefined,
          criteria_scores: Object.keys(criteriaScores).length > 0 ? criteriaScores : undefined,
        }),
      {
        onSuccess: (rating) => {
          onCreated(rating);
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
      title={t("assignments.rateWorkerTitle")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={create.pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            {t("common.rate")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label={t("fields.score0to100")}
          type="number"
          min={0}
          max={100}
          step={1}
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-3">
          <Input
            label={t("fields.punctuality0to100")}
            type="number"
            min={0}
            max={100}
            value={punctuality}
            onChange={(e) => setPunctuality(e.target.value)}
          />
          <Input
            label={t("fields.quality0to100")}
            type="number"
            min={0}
            max={100}
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
          />
          <Input
            label={t("fields.attitude0to100")}
            type="number"
            min={0}
            max={100}
            value={attitude}
            onChange={(e) => setAttitude(e.target.value)}
          />
        </div>
        <Textarea
          label={t("fields.commentOptional")}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={3}
        />
        <FormError>{fieldError ?? create.error}</FormError>
      </div>
    </Modal>
  );
}

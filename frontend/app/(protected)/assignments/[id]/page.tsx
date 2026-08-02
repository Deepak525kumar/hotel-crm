"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useAssignment } from "@/hooks/useAssignments";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { ApiError, assignmentsApi, qualityApi } from "@/lib/api";
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
import type { QualityVerification, Rating, RoomsCompletedEntry } from "@/lib/types";

export default function AssignmentDetailPage() {
  const params = useParams<{ id: string }>();
  const { id } = params;

  const { data: assignment, isLoading, error, mutate } = useAssignment(id);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
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

  const start = () =>
    action.run(() => assignmentsApi.start(id), {
      key: "start",
      onSuccess: (updated) => mutate(updated, { revalidate: false }),
      errorMessage: "Failed to start assignment. Please try again.",
    });

  const complete = () =>
    action.run(() => assignmentsApi.complete(id), {
      key: "complete",
      onSuccess: (updated) => mutate(updated, { revalidate: false }),
      errorMessage: "Failed to complete assignment. Please try again.",
    });

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
                  disabled={action.pending}
                >
                  Cancel
                </Button>
              )}
              {canStart && (
                <Button
                  onClick={start}
                  loading={action.isPending("start")}
                  disabled={action.isPending("cancel")}
                >
                  Start shift
                </Button>
              )}
              {canComplete && (
                <Button
                  onClick={complete}
                  loading={action.isPending("complete")}
                  disabled={action.isPending("cancel")}
                >
                  Complete
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <RoleGate allow={["admin", "manager"]}>
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              {loggedRoomsCompleted
                ? `Logged ${loggedRoomsCompleted.rooms_completed} rooms completed.`
                : "Log the rooms completed count for this assignment."}
            </div>
            {loggedRoomsCompleted ? (
              <Badge tone="success">Logged</Badge>
            ) : (
              <Button
                variant="outline"
                onClick={() => setRoomsCompletedOpen(true)}
                className="shrink-0"
              >
                Log rooms completed
              </Button>
            )}
          </CardContent>
        </Card>
      </RoleGate>

      <RoleGate allow={["admin", "manager", "checker"]}>
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
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
                Verify
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              {loggedRating
                ? `Rated — score ${loggedRating.score}/100.`
                : "Rate the worker's performance for this assignment."}
            </div>
            {loggedRating ? (
              <Badge tone="success">Rated</Badge>
            ) : (
              <Button variant="outline" onClick={() => setRatingOpen(true)} className="shrink-0">
                Rate
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
        title="Cancel assignment"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={action.isPending("cancel")}
            >
              Keep assignment
            </Button>
            <Button
              variant="danger"
              onClick={cancel}
              loading={action.isPending("cancel")}
            >
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
      setFieldError("Rooms completed must be a whole number of 0 or more.");
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
      title="Log rooms completed"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={log.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={log.pending}>
            Log
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Rooms completed"
          type="number"
          min={0}
          step={1}
          value={roomsCompleted}
          onChange={(e) => setRoomsCompleted(e.target.value)}
        />
        <Textarea
          label="Notes (optional)"
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
      setFieldError("Score must be a whole number from 0 to 100.");
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
      title="Verify assignment"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={create.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            Verify
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Score (0–100)"
          type="number"
          min={0}
          max={100}
          step={1}
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />
        <p className="text-xs text-gray-500">
          Status is derived from the score: 70+ passes, 40–69 needs rework, below 40 fails.
        </p>
        <Textarea
          label="Notes (optional)"
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
      setFieldError("Score must be a whole number from 0 to 100.");
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
      title="Rate worker"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={create.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            Rate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Score (0–100)"
          type="number"
          min={0}
          max={100}
          step={1}
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Punctuality"
            type="number"
            min={0}
            max={100}
            value={punctuality}
            onChange={(e) => setPunctuality(e.target.value)}
          />
          <Input
            label="Quality"
            type="number"
            min={0}
            max={100}
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
          />
          <Input
            label="Attitude"
            type="number"
            min={0}
            max={100}
            value={attitude}
            onChange={(e) => setAttitude(e.target.value)}
          />
        </div>
        <Textarea
          label="Comment (optional)"
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

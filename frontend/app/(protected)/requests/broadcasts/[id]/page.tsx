"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useWorkRequest, useBroadcastEligibility } from "@/hooks/useWorkRequests";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useHotel } from "@/hooks/useHotels";
import { ApiError, workRequestsApi } from "@/lib/api";
import { JobDispatchPhase2WriteGate } from "@/components/auth/RoleGate";
import { useAuthStore } from "@/stores/auth";
import { WorkRequestStatusBadge } from "@/components/work-requests/StatusBadge";
import { AssignmentStatusBadge } from "@/components/assignments/AssignmentStatusBadge";
import { UserRef } from "@/components/users/UserRef";
import { useAssignments } from "@/hooks/useAssignments";
import { formatDateTime } from "@/lib/format";
import type { AcceptBroadcastResultDto, SkillTag } from "@/lib/types";
import { MapPin } from "lucide-react";
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
  PageHeader,
  Skeleton,
  TextLink,
} from "@/components/ui";

const SKILL_LABELS: Record<string, string> = {
  CLEANER: "Cleaner",
  PUBLIC_SERVICE: "Public service",
  KITCHEN_DISHWASHER: "Kitchen dishwasher",
  WAITER: "Waiter",
};

export default function BroadcastDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  // The backend's eligibility route (GET /work-requests/broadcasts/:id/
  // eligibility) has no requireRole gate — any authenticated role can call
  // it, and the response is role-scoped server-side: admin/manager get an
  // aggregate eligible_count per slot, a worker/checker instead gets their
  // OWN `eligible: boolean` (SkillSlotEligibilityDto's doc comment) — no
  // eligible_worker_ids field exists on the wire for anyone. Both shapes
  // come from the same fetch; canSeeAggregateEligibility only gates which
  // one is rendered.
  const role = useAuthStore((s) => s.user?.role);
  const canSeeAggregateEligibility = role === "admin" || role === "manager";
  const canAccept = role === "worker" || role === "checker";

  const { data: request, isLoading, error, mutate } = useWorkRequest(id);
  const { data: hotel } = useHotel(request?.hotel_id);
  const { assignments, isLoading: assignmentsLoading } = useAssignments({ job_request_id: id });
  
  const {
    data: eligibility,
    isLoading: eligibilityLoading,
    error: eligibilityError,
    mutate: mutateEligibility,
  } = useBroadcastEligibility(id);
  const close = useAsyncAction();
  const accept = useAsyncAction();
  const [acceptResult, setAcceptResult] = useState<AcceptBroadcastResultDto | null>(null);

  const onClose = () =>
    close.run(() => workRequestsApi.manualCloseBroadcast(id), {
      onSuccess: (updated) => mutate(updated, { revalidate: false }),
      errorMessage: "Failed to close this broadcast. Please try again.",
    });

  const onAccept = (skill: SkillTag) =>
    accept.run(() => workRequestsApi.acceptBroadcast(id, { skill }), {
      key: skill,
      onSuccess: (result) => {
        setAcceptResult(result);
        // Re-fetch both the request (confirmed_count moved) and this
        // worker's own eligibility (now assigned that day, so any other
        // open slot they'd have been eligible for no longer shows them as
        // such).
        void mutate();
        void mutateEligibility();
      },
      errorMessage: "Failed to accept this shift. Please try again.",
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

  if (error || !request || !request.skill_slots || request.skill_slots.length === 0) {
    return (
      <div className="space-y-4">
        <TextLink href="/requests/broadcasts" className="text-sm">
          ← Back to broadcasts
        </TextLink>
        <Card>
          <CardContent className="text-sm text-red-600 dark:text-red-400">
            {error instanceof ApiError && error.status === 404
              ? "This broadcast was not found."
              : "Failed to load this broadcast."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const eligibilityBySkill = new Map(
    (eligibility?.slots ?? []).map((slot) => [slot.skill, slot]),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <TextLink href="/requests/broadcasts" className="text-sm">
          ← Back to broadcasts
        </TextLink>
        <PageHeader
          className="mt-2"
          title={
            <span className="flex items-center gap-3">
              Broadcast
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
            <DataRow
              label="Hotel"
              value={
                <div className="flex flex-col gap-1">
                  <TextLink href={`/hotels/${request.hotel_id}`}>
                    {hotel?.name ?? "View hotel"}
                  </TextLink>
                  {hotel && (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {hotel.address}, {hotel.city}, {hotel.country}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1"
                        onClick={() => {
                          const query = encodeURIComponent(`${hotel.name}, ${hotel.address}, ${hotel.city}, ${hotel.country}`);
                          window.open(`https://maps.google.com/?q=${query}`, "_blank");
                        }}
                      >
                        <MapPin className="h-4 w-4" />
                        Maps
                      </Button>
                    </div>
                  )}
                </div>
              }
            />
            <DataRow label="Shift date" value={request.shift_date} />
            <DataRow
              label="Time"
              value={`${request.shift_start_time}–${request.shift_end_time}`}
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
              value={request.published_at ? formatDateTime(request.published_at) : "—"}
            />
          </DataList>
        </CardContent>
      </Card>

      {request.description && (
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-gray-700 dark:text-gray-300">
            <p className="whitespace-pre-wrap">{request.description}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{canSeeAggregateEligibility ? "Skills & eligibility" : "Skills"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {eligibilityError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              Failed to load eligibility for this broadcast.
            </p>
          ) : (
            request.skill_slots.map((slot) => {
              const slotEligibility = eligibilityLoading ? null : eligibilityBySkill.get(slot.skill);
              const eligibleCount = canSeeAggregateEligibility ? slotEligibility?.eligible_count ?? 0 : null;
              const filled = slot.confirmed_count >= slot.headcount;
              const canAcceptThisSlot =
                canAccept &&
                request.status === "OPEN" &&
                !filled &&
                !eligibilityLoading &&
                slotEligibility?.eligible === true;
              return (
                <div
                  key={slot.id}
                  className="flex items-center justify-between gap-4 rounded-md border border-gray-200 px-4 py-3 dark:border-gray-800"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {SKILL_LABELS[slot.skill] ?? slot.skill}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {slot.confirmed_count}/{slot.headcount} confirmed
                      {eligibleCount !== null && !filled
                        ? ` · ${eligibleCount} eligible worker${eligibleCount === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </div>
                  {filled ? (
                    <span className="shrink-0 text-sm font-medium text-green-700 dark:text-green-400">Filled</span>
                  ) : canAcceptThisSlot ? (
                    <Button
                      size="sm"
                      className="shrink-0"
                      onClick={() => onAccept(slot.skill)}
                      loading={accept.isPending(slot.skill)}
                      disabled={accept.pending}
                    >
                      Accept
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {acceptResult && (
        <Card>
          <CardContent className="flex items-center gap-3">
            {acceptResult.status === "accepted" ? (
              <>
                <Badge tone="success">Confirmed</Badge>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  You&rsquo;re confirmed for this shift ({SKILL_LABELS[acceptResult.skill] ?? acceptResult.skill}).
                </p>
              </>
            ) : (
              <>
                <Badge tone="warning">Already filled</Badge>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Someone else claimed this slot just before you — no shift was assigned.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <FormError>{accept.error}</FormError>

      <JobDispatchPhase2WriteGate>
        {request.status === "OPEN" && (
          <Card>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Close this broadcast early if you no longer need it filled.
              </div>
              <Button variant="outline" onClick={onClose} loading={close.pending}>
                Close broadcast
              </Button>
            </CardContent>
          </Card>
        )}
      </JobDispatchPhase2WriteGate>

      <FormError>{close.error}</FormError>

      {canSeeAggregateEligibility && (
        <Card>
          <CardHeader>
            <CardTitle>Accepted workers</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            {assignmentsLoading ? (
              <div className="py-4 text-center text-sm text-gray-500">Loading assignments...</div>
            ) : assignments.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No workers have accepted this broadcast yet.</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {assignments.map((assignment) => (
                  <div key={assignment.id} className="flex items-center justify-between py-3">
                    <UserRef userId={assignment.worker_id} />
                    <div className="flex items-center gap-4">
                      <AssignmentStatusBadge status={assignment.status} />
                      <TextLink href={`/assignments/${assignment.id}`} className="text-sm">
                        View
                      </TextLink>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

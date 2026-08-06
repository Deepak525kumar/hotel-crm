"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useEmploymentRecord } from "@/hooks/useEmployment";
import { useHotelGroups } from "@/hooks/useHotels";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAuthStore } from "@/stores/auth";
import { employeesApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DataList,
  DataRow,
  FormError,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { EMPLOYMENT_STATUS_TONE, EMPLOYMENT_STATUS_LABEL } from "@/lib/employmentStatus";
import type { DeactivationReason, SkillTag } from "@/lib/types";

// Mirrors the backend `SkillTag` Prisma enum (schema.prisma) — a fixed,
// schema-level enum (REQ-EMP-003), not an admin-managed lookup table, so it
// can only change via a migration that would also require updating this
// list. No API currently exposes the skill catalog for the frontend to
// source this from instead; follow up if that changes.
const SKILL_OPTIONS: { value: SkillTag; label: string }[] = [
  { value: "CLEANER", label: "Cleaner" },
  { value: "PUBLIC_SERVICE", label: "Public service" },
  { value: "KITCHEN_DISHWASHER", label: "Kitchen / dishwasher" },
  { value: "WAITER", label: "Waiter" },
];

// Mirrors the backend DeactivationReason Prisma enum (schema.prisma) — a
// fixed set, same reasoning as SKILL_OPTIONS above.
const DEACTIVATION_REASON_OPTIONS: { value: DeactivationReason; label: string }[] = [
  { value: "TEMPORARY_LEAVE", label: "Temporary leave" },
  { value: "SEASONAL", label: "Seasonal" },
  { value: "SUSPENDED", label: "Suspended" },
];

/**
 * Stands in for the unbuilt Onboarding module (MODULE_SPEC.md: "Onboarding
 * orchestration... Onboarding module" is a separate, unbuilt owner) by
 * driving Employee Management's existing primitives directly: `POST
 * /employees` plus the lifecycle-action endpoints (`submit-for-review`,
 * `approve`, `reject`, `deactivate`, `reactivate`, `rehire`, `delete`,
 * `restore` — REQ-EMP-002 rework, 2026-08-06). Named for the process it
 * represents, not the module whose APIs it calls.
 *
 * The Pending -> Active step is a real, spec-confirmed review decision that
 * the unbuilt Onboarding module would normally own — this card lets an
 * authorized actor (Admin, or a scoped Manager/Regional Manager per ADR-030
 * §3 C-16) perform it directly since no other caller exists yet. Kept as two
 * explicit actions ("Confirm onboarding complete" then "Approve for work")
 * rather than one combined button so the UI doesn't imply a review took
 * place when nothing was reviewed.
 *
 * TEMPORARY ORCHESTRATION UI, not the long-term owner of onboarding: once a
 * real Onboarding module exists and drives these transitions itself, this
 * card should become mostly read-only — reflecting onboarding progress
 * driven elsewhere rather than performing the actions. Do not build further
 * orchestration logic on top of this card; extend the future Onboarding
 * module instead.
 */
export function WorkerOnboardingCard({ userId }: { userId: string }) {
  const { data: record, isLoading, error } = useEmploymentRecord(userId);
  const [createOpen, setCreateOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const action = useAsyncAction();

  // create/delete/restore stay Admin-only at the route
  // (employee-management/routes.ts) even though this card is now reachable
  // by manager/RM (WorkerOnboardingGate widened for the six scoped actions,
  // 2026-08-06). Hide the three Admin-only actions for a non-admin viewer
  // rather than showing a button that always 403s — the backend remains the
  // actual authority (this is visibility, not a second enforcement layer),
  // but a scoped manager should never see a control they can't use.
  const isAdmin = useAuthStore((s) => s.user?.role) === "admin";

  // Refreshes this card's own cache entry plus every other SWR cache whose
  // key could now be stale after a lifecycle transition: the org chart (any
  // group — this component doesn't know which key it's cached under without
  // an extra fetch, so a broad predicate is cheaper than tracking hotel_group_id
  // through every action), and analytics/dashboard aggregates that surface
  // employment-status-derived counts. Revalidates rather than clears — a
  // matched key refetches, it isn't dropped.
  const refresh = () => {
    mutate(["employment-record", userId]);
    mutate(
      (key) =>
        Array.isArray(key) &&
        (key[0] === "org-chart" || key[0] === "analytics-stats" || key[0] === "analytics-leaderboard"),
    );
  };

  const onSubmitForReview = () =>
    action.run(() => employeesApi.submitForReview(record!.employee_id), { key: "submit" }).finally(refresh);

  const onReject = () =>
    action.run(() => employeesApi.reject(record!.employee_id), { key: "reject" }).finally(refresh);

  const onReactivate = () =>
    action.run(() => employeesApi.reactivate(record!.employee_id), { key: "reactivate" }).finally(refresh);

  const onRehire = () =>
    action.run(() => employeesApi.rehire(record!.employee_id), { key: "rehire" }).finally(refresh);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Employment</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-6 text-center text-sm text-red-600">
              Failed to load employment status.
            </p>
          ) : isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : !record ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Not yet onboarded.</p>
              {isAdmin ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  Start onboarding
                </Button>
              ) : (
                <p className="text-sm text-gray-400">Only an Admin can start onboarding.</p>
              )}
              <FormError>{action.error}</FormError>
            </div>
          ) : (
            <div className="space-y-4">
              <DataList>
                <DataRow
                  label="Status"
                  value={
                    <Badge tone={EMPLOYMENT_STATUS_TONE[record.status]}>
                      {EMPLOYMENT_STATUS_LABEL[record.status]}
                    </Badge>
                  }
                />
                <DataRow label="Employee ID" value={record.employee_id} />
                <DataRow label="Job title" value={record.job_title} />
                <DataRow label="Start date" value={formatDate(record.start_date)} />
                {/* Only meaningful once it can exceed 1 — a first-time hire
                    reading "Employment cycle: 1" for every worker is noise,
                    not information. Shows starting with the first rehire
                    (DELETED -> PENDING), the only transition that increments it. */}
                {record.employment_cycle > 1 && (
                  <DataRow label="Employment cycle" value={String(record.employment_cycle)} />
                )}
                {record.status === "DEACTIVATED" && record.deactivation_reason && (
                  <DataRow label="Deactivation reason" value={record.deactivation_reason} />
                )}
                {record.status === "DELETED" && (
                  <>
                    <DataRow
                      label="Deleted"
                      value={
                        <span className="text-red-700">
                          {record.deleted_at ? formatDate(record.deleted_at) : "—"}
                        </span>
                      }
                    />
                    {record.deleted_reason && (
                      <DataRow label="Reason" value={record.deleted_reason} />
                    )}
                  </>
                )}
              </DataList>

              {record.status === "PENDING" && !record.submitted_for_review_at && (
                <div className="border-t border-gray-100 pt-4">
                  <p className="mb-2 text-sm text-gray-500">
                    Paperwork/checks pending before this worker can be reviewed for approval.
                  </p>
                  <Button
                    size="sm"
                    onClick={onSubmitForReview}
                    loading={action.isPending("submit")}
                  >
                    Confirm onboarding complete
                  </Button>
                </div>
              )}

              {record.status === "PENDING" && record.submitted_for_review_at && (
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                  <Button size="sm" onClick={() => setApproveOpen(true)}>
                    Approve for work
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onReject}
                    loading={action.isPending("reject")}
                  >
                    Reject
                  </Button>
                </div>
              )}

              {record.status === "ACTIVE" && (
                <div className="border-t border-gray-100 pt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDeactivateOpen(true)}
                  >
                    Deactivate (temporary pause)
                  </Button>
                </div>
              )}

              {record.status === "DEACTIVATED" && (
                <div className="border-t border-gray-100 pt-4">
                  <p className="mb-2 text-sm text-gray-500">
                    Temporarily paused — this worker is still employed and can return directly.
                  </p>
                  <Button size="sm" onClick={onReactivate} loading={action.isPending("reactivate")}>
                    Reactivate
                  </Button>
                </div>
              )}

              {record.status === "REJECTED" && (
                <div className="border-t border-gray-100 pt-4">
                  {/* rehire() (service.ts) never resolves/connects
                      hotel_group_id, unlike approve() — a REJECTED record
                      commonly has none (it was never approved), so a rehire
                      can land ACTIVE but group-less/unassignable with no way
                      to fix it from here. Backend gap, not fixable from this
                      component; flag rather than silently promise a group
                      gets set. */}
                  {!record.hotel_group_id && (
                    <p className="mb-2 text-sm text-amber-600">
                      This record has no hotel group. Rehiring won&apos;t set one — the worker
                      will become Active but unassignable until a group is set separately.
                    </p>
                  )}
                  <Button size="sm" onClick={onRehire} loading={action.isPending("rehire")}>
                    Rehire
                  </Button>
                </div>
              )}

              {(record.status === "ACTIVE" ||
                record.status === "DEACTIVATED" ||
                record.status === "REJECTED") &&
                isAdmin && (
                  <div className="border-t border-gray-100 pt-4">
                    <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)}>
                      Delete (left the company)
                    </Button>
                  </div>
                )}

              {record.status === "DELETED" && isAdmin && (
                <div className="border-t border-gray-100 pt-4">
                  <p className="mb-2 text-sm text-gray-500">
                    A restored record must go through approval again before becoming active.
                  </p>
                  <RestoreButton employeeId={record.employee_id} onDone={refresh} />
                </div>
              )}

              <FormError>{action.error}</FormError>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateEmploymentModal
        userId={userId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      {record && (
        <>
          <ApproveModal
            userId={userId}
            employeeId={record.employee_id}
            open={approveOpen}
            onClose={() => setApproveOpen(false)}
          />
          <DeactivateModal
            userId={userId}
            employeeId={record.employee_id}
            open={deactivateOpen}
            onClose={() => setDeactivateOpen(false)}
          />
          <DeleteModal
            userId={userId}
            employeeId={record.employee_id}
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
          />
        </>
      )}
    </>
  );
}

// Admin-only (DELETED -> PENDING is not exposed to a scoped manager per
// ADR-030 §3 note ³ — delete/restore cross the account boundary). Not
// gated inline here since the backend already denies non-admin callers;
// this button simply won't do anything useful for a non-admin, matching
// how the rest of this card relies on the API's own authorization rather
// than duplicating role checks client-side.
function RestoreButton({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
  const action = useAsyncAction();
  const onRestore = () =>
    action.run(() => employeesApi.restore(employeeId), { key: "restore" }).finally(onDone);

  return (
    <div className="space-y-2">
      <Button size="sm" onClick={onRestore} loading={action.pending}>
        Restore (start a new employment cycle)
      </Button>
      <FormError>{action.error}</FormError>
    </div>
  );
}

function CreateEmploymentModal({
  userId,
  open,
  onClose,
}: {
  userId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [skills, setSkills] = useState<SkillTag[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const create = useAsyncAction();

  const reset = () => {
    setEmployeeId("");
    setJobTitle("");
    setStartDate("");
    setSkills([]);
    setFieldError(null);
  };

  const handleClose = () => {
    if (create.pending) return;
    reset();
    onClose();
  };

  const toggleSkill = (skill: SkillTag, checked: boolean) =>
    setSkills((prev) => (checked ? [...prev, skill] : prev.filter((s) => s !== skill)));

  const onSubmit = () => {
    setFieldError(null);
    if (!employeeId.trim() || !jobTitle.trim() || !startDate) {
      setFieldError("Employee ID, job title, and start date are required.");
      return;
    }

    create.run(
      () =>
        employeesApi.create({
          user_id: userId,
          employee_id: employeeId.trim(),
          job_title: jobTitle.trim(),
          start_date: startDate,
          ...(skills.length ? { skills } : {}),
        }),
      {
        onSuccess: async () => {
          await mutate(["employment-record", userId]);
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
      title="Start onboarding"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={create.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            Start onboarding
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Employee ID"
          hint="This organization's own HR/badge identifier, not the account ID."
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        />
        <Input
          label="Job title"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
        />
        <Input
          label="Start date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Skills (optional)</p>
          {SKILL_OPTIONS.map((opt) => (
            <Checkbox
              key={opt.value}
              label={opt.label}
              checked={skills.includes(opt.value)}
              onChange={(e) => toggleSkill(opt.value, e.target.checked)}
            />
          ))}
        </div>
        <FormError>{fieldError ?? create.error}</FormError>
      </div>
    </Modal>
  );
}

function ApproveModal({
  userId,
  employeeId,
  open,
  onClose,
}: {
  userId: string;
  employeeId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [hotelGroupId, setHotelGroupId] = useState("");
  const { groups } = useHotelGroups();
  const approve = useAsyncAction();

  const reset = () => setHotelGroupId("");

  const handleClose = () => {
    if (approve.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    approve.run(
      () =>
        employeesApi.approve(employeeId, {
          ...(hotelGroupId.trim() ? { hotel_group_id: hotelGroupId.trim() } : {}),
        }),
      {
        onSuccess: async () => {
          await mutate(["employment-record", userId]);
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
      title="Approve for work"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={approve.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={approve.pending}>
            Approve
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Hotel group is auto-detected when a Regional Manager or Hotel Manager approves — it
          isn&apos;t for an Admin account, so this must be set here or the worker becomes active
          but unassignable to any hotel.
        </p>
        <Select
          label="Hotel group"
          value={hotelGroupId}
          onChange={(e) => setHotelGroupId(e.target.value)}
          options={[
            { value: "", label: "Select a hotel group…" },
            ...groups.map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
        <FormError>{approve.error}</FormError>
      </div>
    </Modal>
  );
}

function DeactivateModal({
  userId,
  employeeId,
  open,
  onClose,
}: {
  userId: string;
  employeeId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<DeactivationReason | "">("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const deactivate = useAsyncAction();

  const reset = () => {
    setReason("");
    setFieldError(null);
  };

  const handleClose = () => {
    if (deactivate.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    if (!reason) {
      setFieldError("A reason is required.");
      return;
    }
    deactivate.run(() => employeesApi.deactivate(employeeId, { deactivation_reason: reason }), {
      onSuccess: async () => {
        await mutate(["employment-record", userId]);
        reset();
        onClose();
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Deactivate (temporary pause)"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={deactivate.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={deactivate.pending}>
            Deactivate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          This worker stays employed and can be reactivated directly, with no re-approval. Future
          assignments are cancelled. If this person has left the company, use Delete instead.
        </p>
        <Select
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as DeactivationReason)}
          options={[
            { value: "", label: "Select a reason…" },
            ...DEACTIVATION_REASON_OPTIONS,
          ]}
        />
        <FormError>{fieldError ?? deactivate.error}</FormError>
      </div>
    </Modal>
  );
}

function DeleteModal({
  userId,
  employeeId,
  open,
  onClose,
}: {
  userId: string;
  employeeId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const deleteAction = useAsyncAction();

  const reset = () => {
    setReason("");
    setFieldError(null);
  };

  const handleClose = () => {
    if (deleteAction.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    if (!reason.trim()) {
      setFieldError("A reason is required.");
      return;
    }
    deleteAction.run(() => employeesApi.deleteEmployee(employeeId, { deleted_reason: reason.trim() }), {
      onSuccess: async () => {
        await mutate(["employment-record", userId]);
        reset();
        onClose();
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Delete (left the company)"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={deleteAction.pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onSubmit} loading={deleteAction.pending}>
            Delete
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          This also deactivates the worker&apos;s account and cancels their future assignments. It
          can be reversed with Restore, which requires re-approval before the worker becomes
          active again.
        </p>
        <Textarea
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Resigned, contract ended"
        />
        <FormError>{fieldError ?? deleteAction.error}</FormError>
      </div>
    </Modal>
  );
}

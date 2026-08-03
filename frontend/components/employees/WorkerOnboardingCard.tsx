"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useEmploymentRecord } from "@/hooks/useEmployment";
import { useHotelGroups } from "@/hooks/useHotels";
import { useAsyncAction } from "@/hooks/useAsyncAction";
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
} from "@/components/ui";
import type { EmploymentStatus, SkillTag } from "@/lib/types";

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

const STATUS_TONE: Record<EmploymentStatus, "warning" | "success" | "neutral" | "danger"> = {
  INACTIVE: "warning",
  UNDER_REVIEW: "warning",
  ACTIVE: "success",
  REJECTED: "danger",
  DEACTIVATED: "neutral",
};

const STATUS_LABEL: Record<EmploymentStatus, string> = {
  INACTIVE: "Onboarding started",
  UNDER_REVIEW: "Ready for approval",
  ACTIVE: "Active",
  REJECTED: "Rejected",
  DEACTIVATED: "Deactivated",
};

/**
 * Stands in for the unbuilt Onboarding module (MODULE_SPEC.md: "Onboarding
 * orchestration... Onboarding module" is a separate, unbuilt owner) by
 * driving Employee Management's existing primitives directly:
 * `POST /employees`, `POST /employees/:id/lifecycle-signal`. Named for the
 * process it represents, not the module whose APIs it calls.
 *
 * The Under-Review -> Active step is a real, spec-confirmed review decision
 * (MODULE_SPEC.md State and Lifecycle: "Under Review — onboarding complete;
 * application in the manager pool") that the unbuilt Onboarding module would
 * normally own — this card lets an Admin perform it directly since no other
 * caller exists yet (`lifecycle-signal`'s own Admin-gate, OD-EMP-09, is the
 * same stopgap). Kept as two explicit actions ("Confirm onboarding complete"
 * then "Approve for work") rather than one combined button so the UI doesn't
 * imply a review took place when nothing was reviewed.
 *
 * TEMPORARY ORCHESTRATION UI, not the long-term owner of onboarding: once a
 * real Onboarding module exists and drives these transitions itself (via
 * `IF-EMP-LifecycleSignal`, unchanged), this card should become mostly
 * read-only — reflecting onboarding progress driven elsewhere rather than
 * performing the actions. Do not build further orchestration logic on top of
 * this card; extend the future Onboarding module instead.
 */
export function WorkerOnboardingCard({ userId }: { userId: string }) {
  const { data: record, isLoading, error } = useEmploymentRecord(userId);
  const [createOpen, setCreateOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const action = useAsyncAction();

  const refresh = () => mutate(["employment-record", userId]);

  const onSubmitForReview = () =>
    action
      .run(
        () => employeesApi.lifecycleSignal(record!.employee_id, { signal: "submitted_for_review" }),
        { key: "submit" },
      )
      .finally(refresh);

  const onReject = () =>
    action
      .run(() => employeesApi.lifecycleSignal(record!.employee_id, { signal: "rejected" }), {
        key: "reject",
      })
      .finally(refresh);

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
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                Start onboarding
              </Button>
              <FormError>{action.error}</FormError>
            </div>
          ) : (
            <div className="space-y-4">
              <DataList>
                <DataRow
                  label="Status"
                  value={<Badge tone={STATUS_TONE[record.status]}>{STATUS_LABEL[record.status]}</Badge>}
                />
                <DataRow label="Employee ID" value={record.employee_id} />
                <DataRow label="Job title" value={record.job_title} />
                <DataRow label="Start date" value={formatDate(record.start_date)} />
              </DataList>

              {record.status === "INACTIVE" && (
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

              {record.status === "UNDER_REVIEW" && (
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
        <ApproveModal
          userId={userId}
          employeeId={record.employee_id}
          open={approveOpen}
          onClose={() => setApproveOpen(false)}
        />
      )}
    </>
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
        employeesApi.lifecycleSignal(employeeId, {
          signal: "approved",
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

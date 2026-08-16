"use client";

import { useState, useEffect } from "react";
import { mutate } from "swr";
import { useEmploymentRecord } from "@/hooks/useEmployment";
import { useDocumentCompleteness } from "@/hooks/useDocuments";
import { useWorkerContract } from "@/hooks/useContract";
import { useHotelGroups } from "@/hooks/useHotels";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useEmploymentPermissions } from "@/hooks/useEmploymentPermissions";
import { employeesApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  Card, Checkbox,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  FormError,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { EMPLOYMENT_STATUS_TONE, EMPLOYMENT_STATUS_LABEL } from "@/lib/employmentStatus";
import { SKILL_OPTIONS, SKILL_LABEL_KEY } from "@/lib/skills";
import type { DeactivationReason, SkillTag } from "@/lib/types";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const { data: record, isLoading, error } = useEmploymentRecord(userId);
  const [approveOpen, setApproveOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editSkillsOpen, setEditSkillsOpen] = useState(false);
  const action = useAsyncAction();



  // Named capabilities, not a raw role check — see useEmploymentPermissions
  // for the full role->capability mapping and its own caveat (role-only,
  // not a substitute for the backend's group-scope check on a specific
  // record). Hides the Admin-only actions for a non-admin viewer rather
  // than showing a button that always 403s.
  // `subjectUserId` is what makes RULE B (2026-08-12, "nobody may perform
  // another user's onboarding") expressible here: `canSubmitForReview` is an
  // identity comparison against this card's subject, not a role check. On an
  // admin viewing ANOTHER user's profile it is false, so the
  // "Confirm onboarding complete" button is not rendered — matching the
  // backend, which now 403s that call.
  const {
    canDeleteEmployment,
    canRestoreEmployment,
    canSubmitForReview,
  } = useEmploymentPermissions({ subjectUserId: userId });

  // Document completeness — needed to gate "Confirm onboarding complete".
  // Only fetched when the record is in PENDING state (before submission).
  const isPendingBeforeSubmit = record?.status === "PENDING" && !record?.submitted_for_review_at;
  const isPendingAfterSubmit  = record?.status === "PENDING" && !!record?.submitted_for_review_at;
  const { data: docCompleteness } = useDocumentCompleteness(
    isPendingBeforeSubmit ? userId : null,
    false // conservative: backend enforces the real work-permit requirement
  );
  // Contract status — needed to gate "Approve for work".
  // Only fetched when the record is submitted and awaiting approval.
  const { data: contractStatus } = useWorkerContract(userId);
  const isContractExpired = contractStatus?.end_date ? new Date(contractStatus.end_date) < new Date() : false;
  // Uses the server-derived `is_valid` (status AND unexpired), not a status
  // comparison: nothing ever transitions a contract out of ACTIVE when its
  // expiry passes, so a status-only check would show "contract approved" for
  // a contract the backend's approve gate will reject as expired.
  const hasApprovedContract = contractStatus?.is_valid === true;
  // 2026-08-13 fix: approve() now confirms a signed-but-unconfirmed contract
  // as part of approving (the same fix applied to ReviewQueueTable) — this
  // card is a second, separate surface that calls the same endpoint and had
  // the same bug: gating solely on `is_valid` (already-confirmed) disabled
  // Approve for every application whose applicant had returned their signed
  // contract but nobody had visited HR's separate confirm screen yet.
  const hasSignedContract = contractStatus?.signed_scan_uploaded === true;
  const canApproveForWork = hasApprovedContract || hasSignedContract;

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

  const onTriggerReonboarding = () =>
    action.run(() => employeesApi.triggerReonboarding(record!.employee_id), { key: "reactivate_new_contract" }).finally(refresh);

  const onRehire = () =>
    action.run(() => employeesApi.rehire(record!.employee_id), { key: "rehire" }).finally(refresh);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("fields.employment")}</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
              Failed to load employment status.
            </p>
          ) : isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : !record ? (
            // ADR-065 (Universal Onboarding Gate): an EmploymentRecord is now
            // created automatically the moment the account exists (see
            // users/service.ts#createUser) — there is no manual "Start
            // onboarding" step for anyone. Reaching this branch means the
            // account predates that change, or the best-effort auto-create
            // failed (logged server-side as user_create_employment_record_failed).
            <div className="space-y-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No employment record found. Contact an administrator.
              </p>
              <FormError>{action.error}</FormError>
            </div>
          ) : (
            <div className="space-y-4">
              <DataList>
                <DataRow
                  label={t("fields.status")}
                  value={
                    <Badge tone={EMPLOYMENT_STATUS_TONE[record.status]}>
                      {EMPLOYMENT_STATUS_LABEL[record.status]}
                    </Badge>
                  }
                />
                <DataRow label="Employee ID" value={record.employee_id} />
                <DataRow label={t("fields.jobTitle")} value={record.job_title} />
                
                {/* Always shown, not gated on skills.length > 0 -- a worker
                    with no skills set yet is precisely the case that most
                    needs the row visible, so there's somewhere to click
                    "Edit" from. Previously hidden entirely when empty, which
                    combined with the Edit trigger being unwired below (never
                    called setEditSkillsOpen(true) anywhere in this file)
                    meant skills could not be set on a worker's first pass
                    through onboarding at all. */}
                <DataRow
                  label={t("fields.skills")}
                  value={
                    <span className="flex items-center gap-2">
                      <span>
                        {record.skills && record.skills.length > 0
                          ? record.skills.map((s) => t(SKILL_LABEL_KEY[s]) ?? s).join(", ")
                          : t("common.notSet")}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => setEditSkillsOpen(true)}>
                        Edit
                      </Button>
                    </span>
                  }
                />

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
                      label={t("status.deleted")}
                      value={
                        <span className="text-red-700 dark:text-red-400">
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
                <div className="border-t border-gray-100 pt-4 dark:border-gray-800 space-y-3">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Paperwork/checks pending before this worker can be reviewed for approval.
                  </p>
                  {docCompleteness && !docCompleteness.is_complete && (
                    <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                      <p className="font-medium">{t("onboarding.documentsRequired")}</p>
                      <ul className="mt-1 list-disc list-inside">
                        {docCompleteness.missing_categories.map((cat) => (
                          <li key={cat} className="capitalize">{cat.replace(/_/g, " ").toLowerCase()}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* RULE B: submit-for-review is self-service only. On
                      another user's profile this renders an explanation
                      instead of a button that would 403 — the button is
                      REMOVED, not merely disabled, because a disabled control
                      still implies "you could, if conditions changed." */}
                  {canSubmitForReview ? (
                    <Button
                      size="sm"
                      onClick={onSubmitForReview}
                      loading={action.isPending("submit")}
                      disabled={docCompleteness != null && !docCompleteness.is_complete}
                    >
                      Confirm onboarding complete
                    </Button>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      Only this employee can upload their documents and submit their own
                      application for review.
                    </p>
                  )}
                </div>
              )}

              {record.status === "PENDING" && record.submitted_for_review_at && (
                <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
                  {!canApproveForWork && contractStatus !== undefined && (
                    <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                      <p className="font-medium">{t("hr.noSignedContract")}</p>
                      <p className="mt-0.5">
                        The worker must upload their signed contract before they can be approved
                        for work.
                      </p>
                    </div>
                  )}
                  {!hasApprovedContract && hasSignedContract && (
                    <div className="rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-3 py-2 text-sm text-blue-800 dark:text-blue-300">
                      Signed contract received — approving will confirm it.
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => setApproveOpen(true)}
                      disabled={!canApproveForWork}
                    >
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
                </div>
              )}

              {record.status === "ACTIVE" && (
                <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
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
                <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                  <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                    {isContractExpired
                      ? "Their contract has expired. Reactivating will trigger a new contract signature flow."
                      : "Temporarily paused — their contract is still valid, so they can return directly."}
                  </p>
                  {isContractExpired ? (
                    <Button size="sm" onClick={onTriggerReonboarding} loading={action.isPending("reactivate_new_contract")}>
                      Reactivate & trigger new contract
                    </Button>
                  ) : (
                    <Button size="sm" onClick={onReactivate} loading={action.isPending("reactivate")}>
                      Reactivate
                    </Button>
                  )}
                </div>
              )}

              {record.status === "REJECTED" && (
                <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                  {/* rehire() (service.ts) never resolves/connects
                      hotel_group_id, unlike approve() — a REJECTED record
                      commonly has none (it was never approved), so a rehire
                      can land ACTIVE but group-less/unassignable with no way
                      to fix it from here. Backend gap, not fixable from this
                      component; flag rather than silently promise a group
                      gets set. */}
                  {!record.hotel_group_id && (
                    <p className="mb-2 text-sm text-amber-600 dark:text-amber-400">
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
                canDeleteEmployment && (
                  <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                    <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)}>
                      Delete (left the company)
                    </Button>
                  </div>
                )}

              {record.status === "DELETED" && canRestoreEmployment && (
                <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                  <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
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
          <EditSkillsModal
            userId={userId}
            employeeId={record.employee_id}
            currentSkills={record.skills}
            open={editSkillsOpen}
            onClose={() => setEditSkillsOpen(false)}
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
        <p className="text-sm text-gray-500 dark:text-gray-400">
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
        <p className="text-sm text-gray-500 dark:text-gray-400">
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
        <p className="text-sm text-gray-500 dark:text-gray-400">
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


function EditSkillsModal({
  userId,
  employeeId,
  currentSkills = [],
  open,
  onClose,
}: {
  userId: string;
  employeeId: string;
  currentSkills?: SkillTag[];
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillTag[]>(currentSkills);
  const action = useAsyncAction();

  // Re-seed local state each time the modal opens.
  //
  // `currentSkills` must NOT be a dependency. It carries a `= []` default, so
  // for a worker who has no skills yet it is a BRAND NEW array on every
  // render. Depending on the array identity meant that opening the modal for
  // such a worker re-ran this effect, set state to yet another new array,
  // re-rendered, and looped until React gave up with "Maximum update depth
  // exceeded" -- from the outside, the Edit button simply did nothing.
  //
  // That hit precisely the workers the row was made visible for: the comment
  // on the skills DataRow above notes it is rendered even when empty so a
  // first-pass worker has somewhere to click Edit from. Empty was the broken
  // case.
  //
  // Keying on the values rather than the reference makes the dependency
  // stable, so the effect runs once per open, as intended.
  const currentSkillsKey = currentSkills.join(",");
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSkills(currentSkills);
    }
    // `currentSkills` is intentionally tracked via `currentSkillsKey`; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentSkillsKey]);

  const handleClose = () => {
    if (action.pending) return;
    // Discard unsaved edits. Safe to use the array directly here: this is an
    // event handler, not an effect, so a fresh reference cannot feed back.
    setSkills(currentSkills);
    onClose();
  };

  const onSubmit = () => {
    action.run(() => employeesApi.update(employeeId, { skills }), {
      onSuccess: async () => {
        await mutate(["employment-record", userId]);
        onClose();
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Edit Skills"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={action.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={action.pending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select the skills this worker is qualified for. Broadcasts are matched against these skills.
        </p>
        <div className="grid grid-cols-2 gap-2 mt-4">
          {SKILL_OPTIONS.map((opt) => (
            <Checkbox
              key={opt.value}
              label={t(opt.labelKey)}
              checked={skills.includes(opt.value)}
              onChange={(e) => {
                const newSkills = e.target.checked
                  ? [...skills, opt.value]
                  : skills.filter((s) => s !== opt.value);
                setSkills(newSkills);
              }}
            />
          ))}
        </div>
        <FormError>{action.error}</FormError>
      </div>
    </Modal>
  );
}

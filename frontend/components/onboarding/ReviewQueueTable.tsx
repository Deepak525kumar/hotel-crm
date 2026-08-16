"use client";

import { useState } from "react";
import useSWR from "swr";
import { employeesApi } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataList,
  DataRow,
  EmptyState,
  FormError,
  Modal,
  Select,
  Table,
  TBody,
  TableSkeleton,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useHotels, useHotelGroups } from "@/hooks/useHotels";
import { useWorkerContract } from "@/hooks/useContract";
import { Eye, Check, X } from "lucide-react";
import { DocumentUploadList } from "./DocumentUploadList";
import type { EmploymentRecord, EmploymentType } from "@/lib/types";
import { useTranslation } from "react-i18next";

// Extended type because the backend includes user info (and, since the
// 2026-08-13 review-routing fix, the creator's own summary — see
// employee-management/service.ts's getReviewQueue()).
type ReviewQueueItem = EmploymentRecord & {
  user?: {
    first_name: string;
    last_name: string;
    email: string;
    role: string;
  };
  created_by?: {
    first_name: string;
    last_name: string;
    role: string;
  } | null;
  /**
   * 2026-08-13 re-onboarding: attached by getReviewQueue() so the reviewer's
   * decision and button label can be rendered from the list payload alone,
   * with no per-row contract fetch. `contract_valid` is the DERIVED
   * status-and-expiry check — never re-derive it from `contract_status`,
   * which stays ACTIVE even after a contract lapses.
   */
  is_reonboarding?: boolean;
  contract_status?: string | null;
  contract_valid?: boolean;
  /** A signed copy is on file (either upload path) and approving will confirm it. */
  contract_signed_uploaded?: boolean;
  contract_end_date?: string | null;
};

const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
};

const ROLE_LABEL: Record<string, string> = {
  WORKER: "Worker",
  CHECKER: "Checker",
  MANAGER: "Manager",
  REGIONAL_MANAGER: "Regional Manager",
  ADMIN: "Admin",
};

function roleLabel(role: string | undefined): string {
  if (!role) return "—";
  return ROLE_LABEL[role] ?? role;
}

export function ReviewQueueTable() {
  const { t } = useTranslation();
  const { data: queue, isLoading, error, mutate } = useSWR<ReviewQueueItem[]>(
    "/employees/review-queue",
    () => employeesApi.getReviewQueue() as Promise<ReviewQueueItem[]>
  );

  const [selectedRecord, setSelectedRecord] = useState<ReviewQueueItem | null>(null);
  const approveAction = useAsyncAction();
  const rejectAction = useAsyncAction();
  const assignAction = useAsyncAction();

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [assignRecord, setAssignRecord] = useState<ReviewQueueItem | null>(null);
  const [assignTarget, setAssignTarget] = useState("");

  // Contract status for the currently-open review — approve() requires a
  // VALID contract server-side (assertApprovedContract,
  // employee-management/service.ts), so the reviewer sees that state
  // up front rather than discovering it only from a failed Approve call.
  //
  // Uses the server-derived `is_valid`, NOT a status comparison: nothing ever
  // transitions a contract out of ACTIVE when its expiry passes, so checking
  // status alone would show "contract approved" for a contract that expired
  // years ago and that the backend will reject.
  const { data: contractStatus } = useWorkerContract(selectedRecord?.user_id ?? null);
  const hasApprovedContract = contractStatus?.is_valid === true;
  // A signed copy on file is enough to approve: approving CONFIRMS that
  // signature server-side (employee-management approve() ->
  // hrService.confirmSignedContractIfPending), which is the same managerial
  // act RULE-HR-03 describes. Requiring the reviewer to first confirm it on a
  // separate HR screen is what made this button permanently disabled.
  // Falls back to the queue row's own flag while the per-worker contract
  // request is still in flight, so the button is not briefly disabled for a
  // record the list already knows is signed.
  const hasSignedContract =
    contractStatus === undefined
      ? selectedRecord?.contract_signed_uploaded === true
      : contractStatus?.signed_scan_uploaded === true;
  const canApprove = hasApprovedContract || hasSignedContract;
  const isReonboarding = selectedRecord?.is_reonboarding === true;

  const { hotels, isLoading: hotelsLoading } = useHotels({ page: 1, limit: 100 });
  const { groups, isLoading: groupsLoading } = useHotelGroups({ page: 1, limit: 100 });

  const handleApprove = () => {
    if (!selectedRecord) return;
    approveAction.run(() => employeesApi.approve(selectedRecord.employee_id), {
      onSuccess: () => {
        const approved = selectedRecord;
        setSelectedRecord(null);
        if (approved.user?.role === "MANAGER" || approved.user?.role === "REGIONAL_MANAGER") {
          setAssignRecord(approved);
        }
        mutate();
      },
    });
  };

  const handleAssign = () => {
    if (!assignRecord || !assignTarget) return;
    const isManager = assignRecord.user?.role === "MANAGER";
    assignAction.run(
      () =>
        employeesApi.assign(
          assignRecord.employee_id,
          isManager ? { primary_hotel_id: assignTarget } : { hotel_group_id: assignTarget }
        ),
      {
        onSuccess: () => {
          setAssignRecord(null);
          setAssignTarget("");
          mutate();
        },
      }
    );
  };

  const handleRejectClick = () => {
    setRejectReason("");
    rejectAction.setError(null);
    setRejectModalOpen(true);
  };

  const submitReject = () => {
    if (!selectedRecord || !rejectReason.trim()) return;
    rejectAction.run(
      () => employeesApi.reject(selectedRecord.employee_id, { reason: rejectReason }),
      {
        onSuccess: () => {
          setRejectModalOpen(false);
          setSelectedRecord(null);
          mutate();
        },
      }
    );
  };

  const columns = 5;

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600 dark:text-red-400">
              Failed to load the review queue. Please try again.
            </div>
          ) : (
            <Table aria-label={t("nav.reviewQueue")}>
              <THead>
                <tr>
                  <TH>{t("users.applicant")}</TH>
                  <TH>{t("fields.role")}</TH>
                  <TH>{t("fields.employmentType")}</TH>
                  <TH>{t("status.submitted")}</TH>
                  <TH className="text-end">{t("common.actions")}</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={columns} />
              ) : !queue || queue.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={columns} className="p-0">
                      <EmptyState
                        title={t("onboarding.reviewQueueEmpty")}
                        description={t("onboarding.reviewQueueEmptyDescription")}
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {queue.map((record) => (
                    <TR key={record.id}>
                      <TD className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{record.user?.first_name} {record.user?.last_name}</span>
                          {record.is_reonboarding && <Badge tone="info">{t("status.returning")}</Badge>}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{record.user?.email}</div>
                      </TD>
                      <TD>{roleLabel(record.user?.role)}</TD>
                      <TD>{EMPLOYMENT_TYPE_LABEL[record.employment_type]}</TD>
                      <TD className="text-gray-500 dark:text-gray-400">
                        {record.submitted_for_review_at ? formatDateTime(record.submitted_for_review_at) : "—"}
                      </TD>
                      <TD className="text-end">
                        <Button variant="outline" size="sm" onClick={() => setSelectedRecord(record)}>
                          <Eye className="me-2 h-4 w-4" />
                          {record.is_reonboarding ? "Reactivate" : "Review"}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal
        open={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
        title={isReonboarding ? "Reactivate returning employee" : "Review application"}
      >
        {selectedRecord && (
          <div className="mt-4 space-y-6">
            <DataList>
              <DataRow label={t("fields.name")} value={`${selectedRecord.user?.first_name ?? ""} ${selectedRecord.user?.last_name ?? ""}`} />
              <DataRow label={t("fields.email")} value={selectedRecord.user?.email ?? "—"} />
              <DataRow label={t("fields.role")} value={roleLabel(selectedRecord.user?.role)} />
              <DataRow label={t("fields.employmentType")} value={EMPLOYMENT_TYPE_LABEL[selectedRecord.employment_type]} />
              {selectedRecord.created_by && (
                <DataRow
                  label={t("profile.createdBy")}
                  value={`${selectedRecord.created_by.first_name} ${selectedRecord.created_by.last_name} (${roleLabel(selectedRecord.created_by.role)})`}
                />
              )}
            </DataList>

            <div>
              {contractStatus === undefined ? null : hasApprovedContract ? (
                <Badge tone="success">
                  Contract valid
                  {contractStatus?.end_date ? ` until ${formatDate(contractStatus.end_date)}` : ""}
                </Badge>
              ) : hasSignedContract ? (
                // The applicant has returned a signed copy of the CURRENT
                // contract; approving confirms it. Deliberately not shown as
                // a warning — there is nothing outstanding for anyone else.
                <Badge tone="info">Signed contract received — approving will confirm it</Badge>
              ) : contractStatus?.is_expired ? (
                <Badge tone="danger">
                  Contract expired
                  {contractStatus.end_date ? ` on ${formatDate(contractStatus.end_date)}` : ""}
                </Badge>
              ) : (
                <Badge tone="warning">
                  {contractStatus ? "Awaiting the applicant's signed contract" : "No contract on file"}
                </Badge>
              )}
            </div>

            {/* 2026-08-13 re-onboarding: a returning employee is a known
                person whose documents are already on file and deliberately
                preserved — the reviewer is reactivating them, not vetting
                them from scratch, so the document checklist is replaced by
                an explicit note. The only real question is the contract. */}
            {isReonboarding ? (
              <div className="space-y-4">
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                <p className="font-medium">Returning employee (cycle {selectedRecord.employment_cycle})</p>
                <p className="mt-0.5">
                  Their profile and documents are preserved from the previous engagement and are
                  not re-collected — the contract is the only thing being re-checked.
                  {hasApprovedContract
                    ? " Their contract is still valid, so they can be reactivated directly."
                    : hasSignedContract
                      ? " Their previous contract had lapsed; a new one was issued and they have returned it signed. Reactivating confirms it."
                      : " Their contract has lapsed. A new one has been issued and is waiting for them to sign and return it."}
                </p>
              </div>
              {/* Still shown for a returning employee: "not re-collected"
                  means they need not re-upload, NOT that the reviewer should
                  be unable to inspect what is already on file. */}
              <div>
                <h3 className="mb-2 font-medium text-gray-900 dark:text-gray-100">{t("onboarding.documentsOnFile")}</h3>
                <div className="rounded-md border border-gray-200 dark:border-gray-700">
                  <DocumentUploadList
                    workerId={selectedRecord.user_id}
                    workPermitRequired={selectedRecord.work_permit_required}
                    disabled
                  />
                </div>
              </div>
              </div>
            ) : (
              <div>
                <h3 className="mb-2 font-medium text-gray-900 dark:text-gray-100">{t("onboarding.submittedDocuments")}</h3>
                <div className="rounded-md border border-gray-200 dark:border-gray-700">
                  <DocumentUploadList
                    workerId={selectedRecord.user_id}
                    workPermitRequired={selectedRecord.work_permit_required}
                    disabled
                  />
                </div>
              </div>
            )}

            <FormError>{approveAction.error}</FormError>

            <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
              <Button
                variant="outline"
                onClick={handleRejectClick}
                loading={rejectAction.pending}
                disabled={approveAction.pending}
              >
                <X className="me-2 h-4 w-4 text-red-500" />
                Reject
              </Button>
              <Button
                onClick={handleApprove}
                loading={approveAction.pending}
                disabled={rejectAction.pending || !canApprove}
                title={
                  canApprove
                    ? undefined
                    : "Waiting for the applicant to upload their signed contract"
                }
              >
                <Check className="me-2 h-4 w-4" />
                {isReonboarding
                  ? hasApprovedContract
                    ? "Reactivate"
                    : "Reactivate & trigger new contract"
                  : hasApprovedContract
                    ? "Approve & activate"
                    : "Confirm contract & approve"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!assignRecord}
        onClose={() => setAssignRecord(null)}
        title={t("onboarding.assignApprovedEmployee")}
      >
        {assignRecord && (
          <div className="mt-4 space-y-6">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {assignRecord.user?.first_name} {assignRecord.user?.last_name} has been approved.
              Assign them to their target location to complete the process.
            </p>
            {assignRecord.user?.role === "MANAGER" ? (
              <Select
                label={t("fields.primaryHotel")}
                value={assignTarget}
                onChange={(e) => setAssignTarget(e.target.value)}
                disabled={hotelsLoading}
                options={[
                  { value: "", label: "Select a hotel…" },
                  ...hotels.map((h) => ({ value: h.id, label: h.name })),
                ]}
              />
            ) : (
              <Select
                label={t("fields.hotelGroup")}
                value={assignTarget}
                onChange={(e) => setAssignTarget(e.target.value)}
                disabled={groupsLoading}
                options={[
                  { value: "", label: "Select a group…" },
                  ...groups.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            )}

            <FormError>{assignAction.error}</FormError>

            <div className="flex items-center justify-end border-t border-gray-200 pt-4 dark:border-gray-700">
              <Button onClick={handleAssign} loading={assignAction.pending} disabled={!assignTarget}>
                Complete assignment
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={rejectModalOpen}
        onClose={() => !rejectAction.pending && setRejectModalOpen(false)}
        title={t("onboarding.rejectApplication")}
      >
        <div className="mt-4 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            This reason is sent to the applicant.
          </p>
          <Textarea
            label={t("onboarding.rejectionReason")}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Invalid document uploaded"
            disabled={rejectAction.pending}
          />
          <FormError>{rejectAction.error}</FormError>
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <Button
              variant="outline"
              onClick={() => setRejectModalOpen(false)}
              disabled={rejectAction.pending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={submitReject}
              loading={rejectAction.pending}
              disabled={!rejectReason.trim()}
            >
              Confirm rejection
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

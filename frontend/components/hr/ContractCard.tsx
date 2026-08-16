"use client";

import { useRef, useState } from "react";
import { mutate } from "swr";
import { useWorkerContract } from "@/hooks/useContract";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAuth } from "@/hooks/useAuth";
import { hrApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  EmptyState,
  FormError,
  Input,
  Modal,
  Skeleton,
} from "@/components/ui";
import type { ContractStatus, EmploymentType } from "@/lib/types";
import { useTranslation } from "react-i18next";

const STATUS_TONE: Record<ContractStatus, "warning" | "success" | "neutral"> = {
  PENDING: "warning",
  ACTIVE: "success",
  EXTENDED: "success",
  PERMANENT: "success",
};

const STATUS_LABEL: Record<ContractStatus, string> = {
  PENDING: "Pending signature",
  ACTIVE: "Active",
  EXTENDED: "Extended",
  PERMANENT: "Permanent",
};

// 2026-08-13 contract feature.
const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
};

/**
 * SPEC-HR-001 (REVIEW @0.2.9, ADR-039/040/044): a worker's contract
 * lifecycle — status, scanned-signature upload/confirm, and the
 * extend/lapse continuation decision. Mirrors PayslipRequestsCard/
 * DocumentsCard's structure. Rendering this behind an unauthorized role is
 * safe — the backend (`hr/routes.ts`) is the authoritative enforcement
 * point — but callers should still wrap it in `HrPayrollGate` so an
 * out-of-scope viewer doesn't see a UI that will only ever 403.
 */
export function ContractCard({ workerId }: { workerId: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  // regional_manager included (2026-08-08 fix): every contract action route
  // in hr/routes.ts (contract-scan/confirm/extend/lapse) already admits
  // admin/manager/regional_manager -- this flag omitted RM, hiding every
  // action button from an RM even though the backend would have allowed it.
  const isManagerOrAdmin =
    user?.role === "admin" || user?.role === "manager" || user?.role === "regional_manager";
  const { data: contract, isLoading, error } = useWorkerContract(workerId);
  const [createOpen, setCreateOpen] = useState(false);
  const action = useAsyncAction();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => mutate(["contract-status", workerId]);

  const onUploadClick = () => fileInputRef.current?.click();

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    action
      .run(() => hrApi.uploadSignedContract(workerId, file), { key: "upload" })
      .finally(refresh);
  };

  const onConfirm = () =>
    action
      .run(() => hrApi.confirmContractSigned(workerId), { key: "confirm" })
      .finally(refresh);

  const onExtend = () =>
    action.run(() => hrApi.extendContract(workerId), { key: "extend" }).finally(refresh);

  const onLapse = () =>
    action.run(() => hrApi.lapseContract(workerId), { key: "lapse" }).finally(refresh);

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t("hr.contract")}</CardTitle>
          {isManagerOrAdmin && !contract && !isLoading && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              {t("hr.createContractAction")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
              {t("hr.loadFailed")}
            </p>
          ) : isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : !contract ? (
            <EmptyState
              title={t("hr.noContract")}
              description={
                isManagerOrAdmin
                  ? "Create a contract once this worker's Personalfragebogen data is recorded."
                  : "No contract has been created for you yet."
              }
            />
          ) : (
            <div className="space-y-4">
              <DataList>
                {/* An EXPIRED contract still reads status ACTIVE (nothing
                    transitions it on lapse), so the badge must reflect the
                    derived `is_expired`, not the raw status, or a lapsed
                    contract shows a green "Active". */}
                <DataRow
                  label={t("fields.status")}
                  value={
                    contract.is_expired ? (
                      <Badge tone="danger">{t("status.expired")}</Badge>
                    ) : (
                      <Badge tone={STATUS_TONE[contract.status]}>{STATUS_LABEL[contract.status]}</Badge>
                    )
                  }
                />
                <DataRow label={t("fields.employmentType")} value={EMPLOYMENT_TYPE_LABEL[contract.employment_type]} />
                <DataRow label={t("jobs.position")} value={contract.position} />
                <DataRow label={t("fields.startDate")} value={formatDate(contract.start_date)} />
                {contract.end_date && <DataRow label={t("fields.endDate")} value={formatDate(contract.end_date)} />}
                {contract.confirmed_at && (
                  <DataRow label={t("hr.signatureConfirmed")} value={formatDate(contract.confirmed_at)} />
                )}
              </DataList>

              {contract.status === "PENDING" && !contract.signed_scan_uploaded && (
                <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                  {/* 2026-08-13 contract feature: the single default contract
                      PDF -- the applicant downloads it, marks the printed
                      Employment type row above (Full-time/Part-time) by
                      hand, signs it, and returns it via the upload button
                      below (manager/admin only). Same-origin navigation, no
                      fetch/blob handling — see hrApi.defaultContractDownloadUrl. */}
                  <a
                    href={hrApi.defaultContractDownloadUrl(workerId)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="outline">
                      {t("hr.downloadContractPdf")}
                    </Button>
                  </a>
                </div>
              )}

              {isManagerOrAdmin && contract.status === "PENDING" && (
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={onFileSelected}
                  />
                  {/* signed_scan_uploaded, not scanned_document_id: the
                      applicant's own upload on My Onboarding sets no Contract
                      column, so keying on the column left the manager stuck on
                      "Upload signed contract" for a contract that had already
                      been signed and returned. */}
                  {!contract.signed_scan_uploaded ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onUploadClick}
                      loading={action.isPending("upload")}
                    >
                      {t("hr.uploadSignedContract")}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={onConfirm} loading={action.isPending("confirm")}>
                      {t("hr.confirmSignature")}
                    </Button>
                  )}
                </div>
              )}

              {isManagerOrAdmin && (contract.status === "ACTIVE" || contract.status === "EXTENDED") && (
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
                  <Button size="sm" onClick={onExtend} loading={action.isPending("extend")}>
                    {t("hr.confirmContinuation")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onLapse}
                    loading={action.isPending("lapse")}
                  >
                    {t("hr.doNotContinue")}
                  </Button>
                </div>
              )}

              <FormError>{action.error}</FormError>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateContractModal
        workerId={workerId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}

function CreateContractModal({
  workerId,
  open,
  onClose,
}: {
  workerId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [templateId, setTemplateId] = useState("");
  const [position, setPosition] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const create = useAsyncAction();

  const reset = () => {
    setTemplateId("");
    setPosition("");
    setStartDate("");
    setEndDate("");
    setFieldError(null);
  };

  const handleClose = () => {
    if (create.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    if (!templateId || !position || !startDate) {
      setFieldError(t("hr.templateStartRequired"));
      return;
    }
    if (endDate && endDate < startDate) {
      setFieldError(t("hr.endDateAfterStart"));
      return;
    }

    create.run(
      () =>
        hrApi.createContract({
          worker_id: workerId,
          template_id: templateId,
          position,
          start_date: startDate,
          end_date: endDate || undefined,
        }),
      {
        onSuccess: async () => {
          await mutate(["contract-status", workerId]);
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
      title={t("hr.createContractTitle")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={create.pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            {t("hr.createContractAction")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Requires this worker&apos;s Personalfragebogen data to already be recorded — creation
          fails otherwise.
        </p>
        <Input
          label={t("fields.templateId")}
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        />
        <Input
          label={t("jobs.position")}
          value={position}
          onChange={(e) => setPosition(e.target.value)}
        />
        <Input
          label={t("fields.startDate")}
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          label={t("fields.endDateOptional")}
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <FormError>{fieldError ?? create.error}</FormError>
      </div>
    </Modal>
  );
}

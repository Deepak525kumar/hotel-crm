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
import type { ContractStatus } from "@/lib/types";

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
  const { user } = useAuth();
  const isManagerOrAdmin = user?.role === "admin" || user?.role === "manager";
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
          <CardTitle>Contract</CardTitle>
          {isManagerOrAdmin && !contract && !isLoading && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              Create contract
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-6 text-center text-sm text-red-600">
              Failed to load contract status.
            </p>
          ) : isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : !contract ? (
            <EmptyState
              title="No contract"
              description={
                isManagerOrAdmin
                  ? "Create a contract once this worker's Personalfragebogen data is recorded."
                  : "No contract has been created for you yet."
              }
            />
          ) : (
            <div className="space-y-4">
              <DataList>
                <DataRow label="Status" value={<Badge tone={STATUS_TONE[contract.status]}>{STATUS_LABEL[contract.status]}</Badge>} />
                <DataRow label="Position" value={contract.position} />
                <DataRow label="Start date" value={formatDate(contract.start_date)} />
                {contract.end_date && <DataRow label="End date" value={formatDate(contract.end_date)} />}
                {contract.confirmed_at && (
                  <DataRow label="Signature confirmed" value={formatDate(contract.confirmed_at)} />
                )}
              </DataList>

              {isManagerOrAdmin && contract.status === "PENDING" && (
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={onFileSelected}
                  />
                  {!contract.scanned_document_id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onUploadClick}
                      loading={action.isPending("upload")}
                    >
                      Upload signed contract
                    </Button>
                  ) : (
                    <Button size="sm" onClick={onConfirm} loading={action.isPending("confirm")}>
                      Confirm signature
                    </Button>
                  )}
                </div>
              )}

              {isManagerOrAdmin && (contract.status === "ACTIVE" || contract.status === "EXTENDED") && (
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                  <Button size="sm" onClick={onExtend} loading={action.isPending("extend")}>
                    Confirm continuation
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onLapse}
                    loading={action.isPending("lapse")}
                  >
                    Do not continue
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
      setFieldError("Template, position, and start date are required.");
      return;
    }
    if (endDate && endDate < startDate) {
      setFieldError("End date must be on or after start date.");
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
      title="Create contract"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={create.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            Create contract
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Requires this worker&apos;s Personalfragebogen data to already be recorded — creation
          fails otherwise.
        </p>
        <Input
          label="Template ID"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        />
        <Input
          label="Position"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
        />
        <Input
          label="Start date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          label="End date (optional)"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <FormError>{fieldError ?? create.error}</FormError>
      </div>
    </Modal>
  );
}

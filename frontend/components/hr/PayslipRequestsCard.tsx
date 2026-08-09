"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useWorkerPayslipRequests } from "@/hooks/usePayslipRequests";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAuth } from "@/hooks/useAuth";
import { hrApi } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FormError,
  Input,
  Modal,
  Skeleton,
} from "@/components/ui";
import type { PayslipRequest, PayslipRequestStatus } from "@/lib/types";

const STATUS_TONE: Record<PayslipRequestStatus, "warning" | "success"> = {
  REQUESTED: "warning",
  FULFILLED: "success",
};

const STATUS_LABEL: Record<PayslipRequestStatus, string> = {
  REQUESTED: "Requested",
  FULFILLED: "Fulfilled",
};

function PayslipRequestRow({
  request,
  canFulfil,
  onFulfil,
  fulfilling,
}: {
  request: PayslipRequest;
  canFulfil: boolean;
  onFulfil: () => void;
  fulfilling: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0 dark:border-gray-800">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {formatDate(request.period_start)} – {formatDate(request.period_end)}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Requested {formatDateTime(request.created_at)}
          {request.fulfilled_at && <> · Fulfilled {formatDateTime(request.fulfilled_at)}</>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Badge>
        {/* Fulfil (POST /hr/payroll/:id/fulfil) is admin/manager/regional_manager-only
            server-side -- gated here too so a worker never sees a button that only 403s. */}
        {canFulfil && request.status === "REQUESTED" && (
          <Button size="sm" variant="outline" onClick={onFulfil} loading={fulfilling}>
            Mark fulfilled
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * SPEC-HR-001 (REVIEW @0.2.9, ADR-039): a worker's payslip-request list.
 * Two distinct create paths, gated to the roles the backend actually
 * accepts them from: a worker requests their own payslip
 * (POST /hr/payslip-requests, requireRole('worker')); a manager/admin/RM
 * creates one on the worker's behalf (POST /hr/payroll, requireRole(['admin',
 * 'manager','regional_manager'])). "Mark fulfilled" (POST /hr/payroll/:id/fulfil)
 * is manager/admin/RM-only and hidden entirely for a worker viewer (2026-08-08
 * fix: this component previously showed both actions unconditionally to every
 * viewer, including a worker, who would only ever get a 403 -- and had no path
 * to the worker's own self-request endpoint at all).
 */
export function PayslipRequestsCard({ workerId }: { workerId: string }) {
  const { user } = useAuth();
  const isSelfWorker = user?.role === "worker" && user.id === workerId;
  const canManage =
    user?.role === "admin" || user?.role === "manager" || user?.role === "regional_manager";
  const { data: requests, isLoading, error } = useWorkerPayslipRequests(workerId);
  const [createOpen, setCreateOpen] = useState(false);
  const fulfil = useAsyncAction();

  // Re-fetches on failure too: a concurrent fulfil from another manager
  // (backend's compare-and-swap) surfaces as a 422 here, and the list must
  // pick up the row's now-FULFILLED status rather than keep showing a
  // "Mark fulfilled" button that will just 422 again on retry.
  const onFulfil = (requestId: string) =>
    fulfil
      .run(() => hrApi.fulfilPayrollRequest(requestId), { key: requestId })
      .finally(() => mutate(["payslip-requests", workerId]));

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Payslip requests</CardTitle>
          {(isSelfWorker || canManage) && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              New request
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
              Failed to load payslip requests.
            </p>
          ) : isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : !requests || requests.length === 0 ? (
            <EmptyState
              title="No payslip requests"
              description="Requests appear here once the worker asks for a payslip, or a manager creates one on their behalf."
            />
          ) : (
            <>
              <ul>
                {requests.map((r) => (
                  <PayslipRequestRow
                    key={r.id}
                    request={r}
                    canFulfil={canManage}
                    onFulfil={() => onFulfil(r.id)}
                    fulfilling={fulfil.isPending(r.id)}
                  />
                ))}
              </ul>
              <FormError className="mt-3">{fulfil.error}</FormError>
            </>
          )}
        </CardContent>
      </Card>

      <CreatePayslipRequestModal
        workerId={workerId}
        selfService={isSelfWorker}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}

function CreatePayslipRequestModal({
  workerId,
  selfService,
  open,
  onClose,
}: {
  workerId: string;
  /** True when the viewer is the worker requesting their OWN payslip
   *  (POST /hr/payslip-requests) rather than a manager acting on their
   *  behalf (POST /hr/payroll). */
  selfService: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const create = useAsyncAction();

  const reset = () => {
    setPeriodStart("");
    setPeriodEnd("");
    setFieldError(null);
  };

  const handleClose = () => {
    if (create.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    if (!periodStart || !periodEnd) {
      setFieldError("Both period dates are required.");
      return;
    }
    if (periodEnd < periodStart) {
      setFieldError("Period end must be on or after period start.");
      return;
    }

    create.run(
      () =>
        selfService
          ? hrApi.requestPayslip({ period_start: periodStart, period_end: periodEnd })
          : hrApi.createPayrollRequest({
              worker_id: workerId,
              period_start: periodStart,
              period_end: periodEnd,
            }),
      {
        onSuccess: async () => {
          await mutate(["payslip-requests", workerId]);
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
      title="New payslip request"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={create.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            Create request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Period start"
          type="date"
          value={periodStart}
          onChange={(e) => setPeriodStart(e.target.value)}
        />
        <Input
          label="Period end"
          type="date"
          value={periodEnd}
          onChange={(e) => setPeriodEnd(e.target.value)}
        />
        <FormError>{fieldError ?? create.error}</FormError>
      </div>
    </Modal>
  );
}

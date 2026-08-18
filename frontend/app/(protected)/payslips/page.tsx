"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useTranslation } from "react-i18next";
import { useAllPayslipRequests } from "@/hooks/usePayslipRequests";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { hrApi } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { RoleGate } from "@/components/auth/RoleGate";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Pager,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableSkeleton,
  TextLink,
  Select,
} from "@/components/ui";
import type { PayslipRequest, PayslipRequestStatus } from "@/lib/types";

const PER_PAGE = 20;

const STATUS_TONE: Record<PayslipRequestStatus, "warning" | "success"> = {
  REQUESTED: "warning",
  FULFILLED: "success",
};

const STATUS_LABEL: Record<PayslipRequestStatus, string> = {
  REQUESTED: "Requested",
  FULFILLED: "Fulfilled",
};

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "REQUESTED", label: "Requested" },
  { value: "FULFILLED", label: "Fulfilled" },
];

function PayslipRequestRow({ request }: { request: PayslipRequest }) {
  const { t } = useTranslation();
  const fulfil = useAsyncAction();

  const onFulfil = () => {
    fulfil
      .run(() => hrApi.fulfilPayrollRequest(request.id), { key: request.id })
      .finally(() => {
        // We mutate the general 'payslip-requests-all' cache.
        // Doing this will re-fetch the current page.
        mutate((key) => Array.isArray(key) && key[0] === "payslip-requests-all");
      });
  };

  return (
    <TR>
      <TD className="font-medium">
        <TextLink href={`/users/${request.worker_id}`}>
          {/* We link to the user, ideally we'd show the name but PayslipRequest doesn't include worker name by default. 
              The backend returns a raw PayslipRequest object. Linking to the worker profile provides details. */}
          View Worker
        </TextLink>
      </TD>
      <TD>
        {formatDate(request.period_start)} – {formatDate(request.period_end)}
      </TD>
      <TD>
        <span className="text-gray-500 dark:text-gray-400">
          {formatDateTime(request.created_at)}
        </span>
      </TD>
      <TD>
        <Badge tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Badge>
      </TD>
      <TD className="text-right">
        {request.status === "REQUESTED" && (
          <Button size="sm" variant="outline" onClick={onFulfil} loading={fulfil.pending}>
            {t("hr.markFulfilledAction")}
          </Button>
        )}
      </TD>
    </TR>
  );
}

export default function PayslipsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  const onStatusChange = (value: string) => {
    setStatus(value);
    setPage(1);
  };

  const { items: requests, isLoading, error, hasNext } = useAllPayslipRequests({
    page,
    limit: PER_PAGE,
    ...(status ? { status: status as PayslipRequestStatus } : {}),
  });

  const columns = 5;

  return (
    <RoleGate roles={["admin", "manager", "regional_manager"]}>
      <div className="space-y-6">
        <PageHeader
          title={t("hr.payslipRequests")}
          description="View and manage worker payslip requests."
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:w-48">
            <Select
              label={t("fields.status")}
              value={status}
              onChange={(e) => onStatusChange(e.target.value)}
              options={STATUS_FILTERS}
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {error ? (
              <div className="px-6 py-10 text-center text-sm text-red-600 dark:text-red-400">
                {t("hr.payslipsLoadFailed")}
              </div>
            ) : (
              <Table aria-label={t("hr.payslipRequests")}>
                <THead>
                  <tr>
                    <TH>Worker</TH>
                    <TH>Period</TH>
                    <TH>Requested At</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                  </tr>
                </THead>
                {isLoading ? (
                  <TableSkeleton columns={columns} />
                ) : requests.length === 0 ? (
                  <TBody>
                    <tr>
                      <TD colSpan={columns} className="p-0">
                        <EmptyState
                          title={t("hr.noPayslipRequests")}
                          description={
                            status
                              ? "No requests match this status."
                              : t("hr.noPayslipRequestsDescription")
                          }
                        />
                      </TD>
                    </tr>
                  </TBody>
                ) : (
                  <TBody>
                    {requests.map((r) => (
                      <PayslipRequestRow key={r.id} request={r} />
                    ))}
                  </TBody>
                )}
              </Table>
            )}
          </CardContent>
        </Card>

        <Pager
          page={page}
          hasNext={hasNext}
          onPageChange={setPage}
          disabled={isLoading}
        />
      </div>
    </RoleGate>
  );
}

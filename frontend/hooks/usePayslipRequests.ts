"use client";

import useSWR from "swr";
import { hrApi } from "@/lib/api";
import { usePaginatedList } from "./usePaginatedList";
import type { PayslipRequestStatus } from "@/lib/types";

/** Lists a worker's payslip requests (group-scoped for manager, unscoped for admin, enforced backend-side). */
export function useWorkerPayslipRequests(workerId: string | null | undefined) {
  return useSWR(
    workerId ? ["payslip-requests", workerId] : null,
    ([, id]) => hrApi.listPayrollRequests({ worker_id: id }),
  );
}

/** Lists all payslip requests (scoped to manager's group, or all for admin). */
export function useAllPayslipRequests(query: {
  status?: PayslipRequestStatus;
  page?: number;
  limit?: number;
}) {
  const limit = query.limit ?? 20;
  return usePaginatedList(
    ["payslip-requests-all", query],
    () => hrApi.listPayrollRequests(query),
    limit
  );
}

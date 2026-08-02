"use client";

import useSWR from "swr";
import { hrApi } from "@/lib/api";

/** Lists a worker's payslip requests (group-scoped for manager, unscoped for admin, enforced backend-side). */
export function useWorkerPayslipRequests(workerId: string | null | undefined) {
  return useSWR(
    workerId ? ["payslip-requests", workerId] : null,
    ([, id]) => hrApi.listPayrollRequests({ worker_id: id }),
  );
}

"use client";

import useSWR from "swr";
import { hrApi } from "@/lib/api";

/** The worker's most recent contract, or `null` if none exists yet (self-scoped for worker, group-scoped for manager, enforced backend-side). */
export function useWorkerContract(workerId: string | null | undefined) {
  return useSWR(
    workerId ? ["contract-status", workerId] : null,
    ([, id]) => hrApi.getContractStatus(id),
  );
}

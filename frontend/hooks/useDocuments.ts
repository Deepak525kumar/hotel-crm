"use client";

import useSWR from "swr";
import { documentsApi } from "@/lib/api";

/** Lists a worker's documents (GD-16: self-scoped for the worker; hotel/group-scoped for admin/manager, enforced backend-side). */
export function useWorkerDocuments(workerId: string | null | undefined) {
  return useSWR(
    workerId ? ["documents", workerId] : null,
    ([, id]) => documentsApi.list(id),
  );
}

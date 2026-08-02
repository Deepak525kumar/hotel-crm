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

/**
 * Whether a worker's document set is complete. `workPermitRequired` has no
 * backend source of truth — it's a caller-declared query param, so this
 * hook takes it as an explicit argument rather than inferring it.
 */
export function useDocumentCompleteness(
  workerId: string | null | undefined,
  workPermitRequired: boolean,
) {
  return useSWR(
    workerId ? ["document-completeness", workerId, workPermitRequired] : null,
    ([, id, required]) => documentsApi.completeness(id, required),
  );
}

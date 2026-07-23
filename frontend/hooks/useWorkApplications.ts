"use client";

import useSWR from "swr";
import { usePaginatedList } from "@/hooks/usePaginatedList";
import { workApplicationsApi } from "@/lib/api";
import type { ListApplicationsQuery } from "@/lib/types";

/**
 * Lists applications for a work request via SWR.
 *
 * Mirrors {@link useWorkRequests}: the backend returns pagination metadata in
 * a sibling envelope field that `apiFetch` does not surface, so paging is
 * driven client-side — callers advance `page` and use `hasNext` (a full page
 * was returned) to decide whether a further page exists.
 *
 * The list is role-scoped on the backend: managers/admins see every
 * application, while workers receive only their own.
 */
export function useWorkApplications(
  workRequestId: string | null | undefined,
  query: ListApplicationsQuery = {},
) {
  const perPage = query.per_page ?? 20;
  const { items, hasNext, ...swr } = usePaginatedList(
    workRequestId
      ? ["work-applications", workRequestId, { ...query, per_page: perPage }]
      : null,
    () => workApplicationsApi.list(workRequestId!, { ...query, per_page: perPage }),
    perPage,
  );
  return { ...swr, applications: items, hasNext };
}

/**
 * Resolves a single application by id.
 *
 * The backend has no single-application read route, so this reuses the list
 * endpoint (the review view is always reached from the list) and selects the
 * matching record client-side.
 */
export function useWorkApplication(
  workRequestId: string | null | undefined,
  applicationId: string | null | undefined,
) {
  const key =
    workRequestId && applicationId
      ? (["work-application", workRequestId, applicationId] as const)
      : null;

  const swr = useSWR(key, async ([, id]) => {
    // per_page is capped at 100 by the backend; paginate until the id is found.
    let page = 1;
    for (;;) {
      const batch = await workApplicationsApi.list(id, { page, per_page: 100 });
      const match = batch.find((a) => a.id === applicationId);
      if (match) return match;
      if (batch.length < 100) return null;
      page += 1;
    }
  });

  return swr;
}

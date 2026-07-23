"use client";

import useSWR from "swr";
import { hotelsApi, workRequestsApi } from "@/lib/api";
import type { ListWorkRequestsQuery } from "@/lib/types";

/**
 * Lists work requests for the given filters via SWR.
 *
 * The backend returns pagination metadata in a sibling envelope field that
 * `apiFetch` does not surface, so paging is driven client-side: callers
 * advance `page` and use `hasNext` (a full page was returned) to decide
 * whether a further page exists.
 */
export function useWorkRequests(query: ListWorkRequestsQuery = {}) {
  const perPage = query.per_page ?? 20;
  // A stable, serialisable key so SWR dedupes/caches per filter combination.
  const key = ["work-requests", { ...query, per_page: perPage }] as const;

  const swr = useSWR(key, ([, q]) => workRequestsApi.list(q));

  return {
    ...swr,
    requests: swr.data ?? [],
    hasNext: (swr.data?.length ?? 0) >= perPage,
  };
}

/** Fetches a single work request by id. */
export function useWorkRequest(id: string | null | undefined) {
  return useSWR(
    id ? ["work-request", id] : null,
    ([, requestId]) => workRequestsApi.get(requestId),
  );
}

/**
 * Lists active hotels for the create form's hotel selector. Requests the
 * backend page cap (100) so the selector isn't silently truncated to the
 * default page size.
 */
export function useHotelOptions() {
  const swr = useSWR(["hotel-options"], () =>
    hotelsApi.list({ is_active: "true", limit: 100 }),
  );
  return { ...swr, hotels: swr.data ?? [] };
}

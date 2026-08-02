"use client";

import useSWR from "swr";
import { usePaginatedList } from "@/hooks/usePaginatedList";
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
  const { items, hasNext, ...swr } = usePaginatedList(
    // A stable, serialisable key so SWR dedupes/caches per filter combination.
    ["work-requests", { ...query, per_page: perPage }],
    () => workRequestsApi.list({ ...query, per_page: perPage }),
    perPage,
  );
  return { ...swr, requests: items, hasNext };
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

/**
 * Job Dispatch Phase 2 (Epic 9 PRs 9.7-9.9, MIG-GAP-04/05/06): lists
 * broadcasts, i.e. work requests that carry skill_slots. Filters
 * server-side via `is_broadcast: true` (GET /work-requests?is_broadcast=
 * true), so pagination is honest — `hasNext` reflects the actual filtered
 * result set, not a raw unfiltered page that got trimmed client-side
 * afterward (an earlier version of this hook did that, before the
 * server-side filter existed; see git history if the old client-side
 * approach needs revisiting).
 *
 * Gated by FEATURE_JOBDISPATCH_PHASE2 server-side (404 while disabled,
 * surfaced to the caller as a normal fetch error).
 */
export function useBroadcasts(query: ListWorkRequestsQuery = {}) {
  const perPage = query.per_page ?? 20;
  const { items, hasNext, ...swr } = usePaginatedList(
    ["work-requests-broadcasts", { ...query, is_broadcast: true, per_page: perPage }],
    () => workRequestsApi.list({ ...query, is_broadcast: true, per_page: perPage }),
    perPage,
  );
  return { ...swr, broadcasts: items, hasNext };
}

/**
 * Job Dispatch Phase 2 (Epic 9 PRs 9.7-9.9, MIG-GAP-04/05/06): per-skill-slot
 * eligibility for one broadcast. Pass `null` for a viewer who must not
 * receive `eligible_worker_ids` (other workers' user ids) — the backend
 * route has no requireRole gate, so the caller is the only enforcement
 * point; see the security note in requests/broadcasts/[id]/page.tsx.
 */
export function useBroadcastEligibility(id: string | null | undefined) {
  return useSWR(
    id ? ["broadcast-eligibility", id] : null,
    ([, requestId]) => workRequestsApi.getBroadcastEligibility(requestId),
  );
}

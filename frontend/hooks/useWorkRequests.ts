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

// The backend page cap (ListWorkRequestsQuerySchema.per_page.max(100)).
const BROADCASTS_PAGE_CAP = 100;

/**
 * Job Dispatch Phase 2 (Epic 9 PRs 9.7-9.9, MIG-GAP-04/05/06): lists
 * broadcasts, i.e. work requests that carry skill_slots. The backend has no
 * dedicated broadcast-list endpoint or filter — this filters the existing
 * `/work-requests` list client-side, same shape `WorkRequest.skill_slots`
 * already documents as the broadcast discriminator.
 *
 * Deliberately NOT paginated: `usePaginatedList`'s `hasNext` is computed
 * from the raw (unfiltered) page length, which would be wrong once a
 * subset of that page is dropped by the client-side filter below — a full
 * raw page can contain zero-to-few broadcasts while still reporting
 * `hasNext: true`, or vice versa. Rather than surface a `Pager` with a
 * misleading contract, this fetches the backend's single page cap in one
 * request; `truncated` tells the caller when even that cap wasn't enough.
 * A server-side broadcast filter (e.g. a query param the backend applies
 * before pagination) would be the real fix. No such filter exists in this
 * backend today, and none is currently tracked as a scheduled PR — an
 * earlier attempt at one was deliberately dropped from this change set
 * during review (it used an unsafe boolean-parsing approach). Revisit
 * this cap if the broadcast-vs-marketplace ratio at a hotel/hotel-group
 * grows large enough that 100 rows stops being enough headroom.
 *
 * Gated by FEATURE_JOBDISPATCH_PHASE2 server-side (404 while disabled,
 * surfaced to the caller as a normal fetch error).
 */
export function useBroadcasts(query: Omit<ListWorkRequestsQuery, "page" | "per_page"> = {}) {
  const swr = useSWR(
    ["work-requests-broadcasts", query],
    () => workRequestsApi.list({ ...query, page: 1, per_page: BROADCASTS_PAGE_CAP }),
  );
  const items = swr.data ?? [];
  return {
    ...swr,
    broadcasts: items.filter((wr) => (wr.skill_slots?.length ?? 0) > 0),
    truncated: items.length >= BROADCASTS_PAGE_CAP,
  };
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

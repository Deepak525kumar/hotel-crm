"use client";

import useSWR from "swr";
import { usePaginatedList } from "@/hooks/usePaginatedList";
import { geoCheckinsApi } from "@/lib/api";
import type { ListGeoCheckinsQuery } from "@/lib/types";

/**
 * Lists geo check-ins (geofence verification events) via SWR. Mirrors
 * {@link useAttendance}: the backend returns pagination metadata in a
 * sibling envelope field that `apiFetch` does not surface, so paging is
 * driven client-side — callers advance `page` and use `hasNext` (a full page
 * was returned) to decide whether a further page exists.
 *
 * The list is role-scoped on the backend (SPEC-GEO-001, GD-14): admin sees
 * every check-in, manager sees only hotels within their own scope claim.
 */
export function useGeoCheckins(query: ListGeoCheckinsQuery = {}) {
  const perPage = query.per_page ?? 20;
  const { items, hasNext, ...swr } = usePaginatedList(
    ["geo-checkins", { ...query, per_page: perPage }],
    () => geoCheckinsApi.list({ ...query, per_page: perPage }),
    perPage,
  );
  return { ...swr, records: items, hasNext };
}

/** Fetches a single geo check-in by id. */
export function useGeoCheckin(id: string | null | undefined) {
  return useSWR(
    id ? ["geo-checkin", id] : null,
    ([, checkinId]) => geoCheckinsApi.get(checkinId),
  );
}

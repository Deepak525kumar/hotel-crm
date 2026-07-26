"use client";

import useSWR from "swr";
import { usePaginatedList } from "@/hooks/usePaginatedList";
import { hotelGroupsApi, hotelsApi, usersApi } from "@/lib/api";
import type {
  ListHotelGroupsQuery,
  ListHotelsQuery,
  ListUsersQuery,
} from "@/lib/types";

/**
 * Lists hotels for the CRM directory via SWR.
 *
 * The backend returns pagination metadata in a sibling envelope field that
 * `apiFetch` does not surface, so paging is driven client-side: callers
 * advance `page` and use `hasNext` (a full page was returned) to decide
 * whether a further page exists.
 */
export function useHotels(query: ListHotelsQuery = {}) {
  const limit = query.limit ?? 20;
  const { items, hasNext, ...swr } = usePaginatedList(
    ["hotels", { ...query, limit }],
    () => hotelsApi.list({ ...query, limit }),
    limit,
  );
  return { ...swr, hotels: items, hasNext };
}

/** Fetches a single hotel by id (detail endpoint — full field set). */
export function useHotel(id: string | null | undefined) {
  return useSWR(
    id ? ["hotel", id] : null,
    ([, hotelId]) => hotelsApi.get(hotelId),
  );
}

/** Lists hotel groups for the CRM directory. */
export function useHotelGroups(query: ListHotelGroupsQuery = {}) {
  const limit = query.limit ?? 20;
  const { items, hasNext, ...swr } = usePaginatedList(
    ["hotel-groups", { ...query, limit }],
    () => hotelGroupsApi.list({ ...query, limit }),
    limit,
  );
  return { ...swr, groups: items, hasNext };
}

/** Fetches a single hotel group by id. */
export function useHotelGroup(id: string | null | undefined) {
  return useSWR(
    id ? ["hotel-group", id] : null,
    ([, groupId]) => hotelGroupsApi.get(groupId),
  );
}

/**
 * Lists users for a selector, filtered by role. Used by the CRM group form to
 * pick a Regional Manager, and available for any other directory selector.
 */
export function useUserOptions(query: ListUsersQuery = {}) {
  const key = ["user-options", { ...query }] as const;
  const swr = useSWR(key, ([, q]) => usersApi.list({ limit: 100, ...q }));
  return { ...swr, users: swr.data ?? [] };
}

/**
 * Lists users eligible to be assigned as a hotel group's Regional Manager
 * (ADR-030 D-5, closing F-3). `GET /users` takes one `role` value, so a
 * manager-or-regional_manager set needs two parallel fetches merged
 * client-side, de-duplicated by id. Safe before and after PR-4/5 land: while
 * `FEATURE_RM_ROLE` stays off (M-3 never run), the `regional_manager` fetch
 * returns an empty set and every candidate still comes from the `manager`
 * fetch — once M-3 promotes users, they appear here with no further code
 * change needed at any of this hook's four call sites.
 */
export function useRegionalManagerCandidates() {
  const managers = useUserOptions({ role: "manager" });
  const regionalManagers = useUserOptions({ role: "regional_manager" });

  // Left to the React Compiler to memoize (Next 16) rather than a manual
  // useMemo, which it cannot reliably preserve across this hook's own
  // composed-hook shape.
  const byId = new Map<string, (typeof managers.users)[number]>();
  for (const user of [...managers.users, ...regionalManagers.users]) {
    byId.set(user.id, user);
  }
  const users = Array.from(byId.values());

  return {
    users,
    isLoading: managers.isLoading || regionalManagers.isLoading,
    error: managers.error ?? regionalManagers.error,
  };
}

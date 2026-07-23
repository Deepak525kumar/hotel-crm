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

"use client";

import useSWR, { SWRConfiguration } from "swr";
import type { Key } from "swr";

/**
 * Shared SWR wrapper for the app's paginated list endpoints.
 *
 * The backend returns pagination metadata in a sibling envelope field that
 * `apiFetch` does not surface, so paging is length-driven: `hasNext` is true
 * when a full page came back. Callers pass a cache `key` (include the query so
 * SWR dedupes per filter combination; pass `null` to skip fetching) and a
 * thunk fetcher, then alias `items` to a domain name (`hotels`, `records`, …).
 */
export function usePaginatedList<T>(
  key: Key,
  fetcher: () => Promise<T[]>,
  pageSize: number,
  options?: SWRConfiguration
) {
  const swr = useSWR<T[]>(key, fetcher, options);
  const items = swr.data ?? [];
  return { ...swr, items, hasNext: items.length >= pageSize };
}

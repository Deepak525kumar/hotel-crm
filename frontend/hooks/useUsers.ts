"use client";

import useSWR from "swr";
import { usePaginatedList } from "@/hooks/usePaginatedList";
import { usersApi } from "@/lib/api";
import type { ListUsersQuery } from "@/lib/types";

/**
 * Lists users for the admin directory via SWR. Paging is client-side (the
 * backend's pagination metadata isn't surfaced by `apiFetch`): advance `page`
 * and use `hasNext` (a full page came back) to decide whether more exist.
 */
export function useUsers(query: ListUsersQuery = {}) {
  const limit = query.limit ?? 20;
  const { items, hasNext, ...swr } = usePaginatedList(
    ["users", { ...query, limit }],
    () => usersApi.list({ ...query, limit }),
    limit,
    { refreshInterval: process.env.NODE_ENV === 'test' ? 0 : 5000 }
  );
  return { ...swr, users: items, hasNext };
}

/** Fetches a single user by id (detail endpoint — includes permissions). */
export function useUser(id: string | null | undefined) {
  return useSWR(id ? ["user", id] : null, ([, userId]) => usersApi.get(userId));
}

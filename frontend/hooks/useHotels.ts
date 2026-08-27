"use client";

import useSWR from "swr";
import { usePaginatedList } from "@/hooks/usePaginatedList";
import { hotelGroupsApi, hotelsApi, usersApi } from "@/lib/api";
import type {
  ListHotelGroupsQuery,
  ListHotelsQuery,
  ListUsersQuery,
  UserDetail,
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
  // We default to active users only for dropdown options (e.g. assigning a worker or manager)
  // because the backend listUsers endpoint now returns deactivated/pending workers by default.
  const activeQuery = { is_active: "true" as const, ...query };
  const key = ["user-options", activeQuery] as const;
  const swr = useSWR(key, ([, q]) => usersApi.list({ limit: 100, ...q }));
  return { ...swr, users: swr.data ?? [] };
}

/**
 * Resolves a batch of user ids to display names, for surfaces (like the
 * calendar grid) that render worker_id-keyed records and need a name for
 * whichever workers actually appear -- not a flat, capped role listing that
 * silently misses anyone outside its first page. There is no batch-by-ids
 * endpoint, so this fans out to the existing single-user GET (usersApi.get),
 * one SWR-deduplicated request per id; cheap at the scale a single visible
 * week/month of placements ever needs (a handful of distinct workers).
 */
export function useUsersByIds(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids)).sort();
  const key = uniqueIds.length > 0 ? (["users-by-ids", uniqueIds] as const) : null;
  const swr = useSWR(key, async ([, idList]) => {
    const results = await Promise.all(
      idList.map(async (id) => {
        try {
          return await usersApi.get(id);
        } catch {
          // A deleted/inaccessible user shouldn't break the whole lookup --
          // callers fall back to the raw id for just that one entry.
          return null;
        }
      }),
    );
    const map = new Map<string, UserDetail>();
    results.forEach((user, i) => {
      if (user) map.set(idList[i], user);
    });
    return map;
  });
  return swr.data ?? new Map<string, UserDetail>();
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
/**
 * Candidates for calendar/roster placement -- WORKER and CHECKER, merged the
 * same way `useRegionalManagerCandidates` merges manager/RM above. A checker
 * works a shift exactly as a worker does (checks in, is placed on the
 * calendar) as of 2026-08-27, but every placement dropdown here had
 * `role: "worker"` hardcoded from before that role existed. The backend gate
 * (`isWorkerEligibleForHotel`) was already role-agnostic -- an employment
 * record plus group scope, nothing checking `role === 'worker'` -- so a
 * checker COULD already be placed via the API; only these dropdowns could
 * never offer one as an option.
 */
export function useShiftWorkerOptions(query: Omit<ListUsersQuery, "role"> = {}) {
  const workers = useUserOptions({ role: "worker", ...query });
  const checkers = useUserOptions({ role: "checker", ...query });

  const byId = new Map<string, (typeof workers.users)[number]>();
  for (const user of [...workers.users, ...checkers.users]) {
    byId.set(user.id, user);
  }
  const users = Array.from(byId.values());

  return {
    users,
    isLoading: workers.isLoading || checkers.isLoading,
    error: workers.error ?? checkers.error,
  };
}

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

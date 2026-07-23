"use client";

import useSWR from "swr";
import { usePaginatedList } from "@/hooks/usePaginatedList";
import { assignmentsApi } from "@/lib/api";
import type { ListAssignmentsQuery } from "@/lib/types";

/**
 * Lists assignments for the given filters via SWR.
 *
 * Mirrors {@link useWorkRequests}: the backend returns pagination metadata in
 * a sibling envelope field that `apiFetch` does not surface, so paging is
 * driven client-side — callers advance `page` and use `hasNext` (a full page
 * was returned) to decide whether a further page exists.
 *
 * The list is role-scoped on the backend: managers/admins see every
 * assignment, while workers receive only their own.
 */
export function useAssignments(query: ListAssignmentsQuery = {}) {
  const perPage = query.per_page ?? 20;
  const { items, hasNext, ...swr } = usePaginatedList(
    // A stable, serialisable key so SWR dedupes/caches per filter combination.
    ["assignments", { ...query, per_page: perPage }],
    () => assignmentsApi.list({ ...query, per_page: perPage }),
    perPage,
  );
  return { ...swr, assignments: items, hasNext };
}

/** Fetches a single assignment by id. */
export function useAssignment(id: string | null | undefined) {
  return useSWR(
    id ? ["assignment", id] : null,
    ([, assignmentId]) => assignmentsApi.get(assignmentId),
  );
}

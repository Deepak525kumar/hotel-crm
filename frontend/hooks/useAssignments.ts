"use client";

import useSWR from "swr";
import { usePaginatedList } from "@/hooks/usePaginatedList";
import { assignmentsApi } from "@/lib/api";
import type { ListAssignmentsQuery, ListCalendarEntriesQuery } from "@/lib/types";

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

/**
 * Job Dispatch Phase 2 (Epic 9 PR 9.5, TREQ-001/MIG-GAP-03): lists calendar
 * entries (direct worker placements, no broadcast/accept cycle) for the
 * given filters. Same pagination shape as {@link useAssignments}.
 */
export function useCalendarEntries(query: ListCalendarEntriesQuery = {}) {
  const perPage = query.per_page ?? 20;
  const { items, hasNext, ...swr } = usePaginatedList(
    ["calendar-entries", { ...query, per_page: perPage }],
    () => assignmentsApi.listCalendarEntries({ ...query, per_page: perPage }),
    perPage,
  );
  return { ...swr, calendarEntries: items, hasNext };
}

/**
 * Calendar grid view: every placement within a bounded day range in one
 * fetch (the backend max page size, 100, comfortably covers a week/month of
 * placements for a single scoped team) — unlike {@link useCalendarEntries},
 * this is not paginated, since the grid renders the whole range at once.
 */
export function useCalendarEntriesInRange(
  range: { from: string; to: string; hotel_id?: string; worker_id?: string } | null,
) {
  return useSWR(
    range ? ["calendar-entries-range", range] : null,
    ([, r]) => assignmentsApi.listCalendarEntries({ ...r, per_page: 100 }),
  );
}

"use client";

import useSWR from "swr";
import { usePaginatedList } from "@/hooks/usePaginatedList";
import { attendanceApi } from "@/lib/api";
import type { ListAttendanceQuery } from "@/lib/types";

/**
 * Lists attendance records for the given filters via SWR.
 *
 * Mirrors {@link useAssignments}: the backend returns pagination metadata in
 * a sibling envelope field that `apiFetch` does not surface, so paging is
 * driven client-side — callers advance `page` and use `hasNext` (a full page
 * was returned) to decide whether a further page exists.
 *
 * The list is role-scoped on the backend: managers/admins/checkers see every
 * record, while workers receive only their own.
 */
export function useAttendance(query: ListAttendanceQuery = {}) {
  const perPage = query.per_page ?? 20;
  const { items, hasNext, ...swr } = usePaginatedList(
    // A stable, serialisable key so SWR dedupes/caches per filter combination.
    ["attendance", { ...query, per_page: perPage }],
    () => attendanceApi.list({ ...query, per_page: perPage }),
    perPage,
  );
  return { ...swr, records: items, hasNext };
}

/** Fetches a single attendance record by id. */
export function useAttendanceRecord(id: string | null | undefined) {
  return useSWR(
    id ? ["attendance-record", id] : null,
    ([, recordId]) => attendanceApi.get(recordId),
  );
}

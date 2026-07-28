"use client";

import useSWR from "swr";
import { calendarApi } from "@/lib/api";

/**
 * Fetches a worker's today-only availability (SPEC-CALENDAR-001 REQ-CAL-T06,
 * ADR-021). Always resolves for "today" — there is no date parameter, and a
 * cached value should be treated as stale as soon as the day rolls over
 * (SWR's default revalidate-on-focus covers the common case of a manager
 * leaving a tab open overnight).
 *
 * The backend denies this read for some role/scope combinations (e.g. a
 * manager outside the worker's Hotel Group, or a checker — RULE-EMP-08-style
 * scoping, ADR-021). Callers should treat a 403 as "not visible to me," not
 * as an application error — see the `error` value's `ApiError.status`.
 */
export function useAvailability(workerId: string | null | undefined) {
  return useSWR(
    workerId ? ["availability", workerId] : null,
    ([, id]) => calendarApi.getAvailability(id),
  );
}

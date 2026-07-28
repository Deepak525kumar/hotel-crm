"use client";

import useSWR from "swr";
import { ApiError, calendarApi } from "@/lib/api";

/**
 * Fetches a worker's today-only availability (SPEC-CALENDAR-001 REQ-CAL-T06,
 * ADR-021). Always resolves for "today" — there is no date parameter, and a
 * cached value should be treated as stale as soon as the day rolls over
 * (SWR's default revalidate-on-focus covers the common case of a manager
 * leaving a tab open overnight).
 *
 * The backend denies this read for some role/scope combinations (e.g. a
 * manager outside the worker's Hotel Group, or a checker — RULE-EMP-08-style
 * scoping, ADR-021) — a 403 is an expected "not visible to me" outcome, not a
 * failure, so callers are meant to render nothing for it rather than an
 * error. Only a 403 is that expected, though: any other failure (5xx,
 * network, malformed response) still logs to the console via `onError`, so a
 * real backend problem isn't silently lost just because the page around it
 * chooses not to interrupt the user for a non-critical enhancement.
 */
export function useAvailability(workerId: string | null | undefined) {
  return useSWR(
    workerId ? ["availability", workerId] : null,
    ([, id]) => calendarApi.getAvailability(id),
    {
      onError: (error) => {
        if (error instanceof ApiError && error.status === 403) return;
        console.error("Failed to load worker availability", error);
      },
    },
  );
}

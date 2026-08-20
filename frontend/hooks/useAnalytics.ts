"use client";

import useSWR from "swr";
import { analyticsApi, qualityApi } from "@/lib/api";

/** Aggregate dashboard stats, optionally scoped to a hotel. */
export function useDashboardStats(hotelId?: string) {
  return useSWR(["analytics-stats", hotelId ?? "all"], () =>
    analyticsApi.stats(hotelId),
  );
}

/** Worker leaderboard, optionally scoped to a hotel. */
export function useLeaderboard(hotelId?: string) {
  const swr = useSWR(["analytics-leaderboard", hotelId ?? "all"], () =>
    analyticsApi.leaderboard(hotelId),
  );
  return { ...swr, entries: swr.data ?? [] };
}

/**
 * ADR-067: the group-scoped peer leaderboard, for worker/checker callers.
 * Deliberately separate from useLeaderboard() above -- that one calls
 * /analytics/leaderboard, which 403s for these two roles by design. This
 * calls /quality/leaderboard, which resolves the caller's own hotel group
 * server-side; there is no hotel_id parameter to pass because a worker or
 * checker cannot widen their own scope.
 */
export function usePeerLeaderboard() {
  const swr = useSWR(["quality-leaderboard"], () => qualityApi.leaderboard());
  return { ...swr, entries: swr.data ?? [] };
}

/** Per-hotel operational summary. */
export function useHotelSummary(hotelId: string | null | undefined) {
  return useSWR(
    hotelId ? ["analytics-hotel-summary", hotelId] : null,
    ([, id]) => analyticsApi.hotelSummary(id),
  );
}

/** GD-06: the caller's own stats (self-scoped). */
export function useMyStats() {
  return useSWR(["analytics-my-stats"], () => analyticsApi.myStats());
}

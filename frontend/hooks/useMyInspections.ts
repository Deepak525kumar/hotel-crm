"use client";

import useSWR from "swr";
import { qualityApi } from "@/lib/api";

/**
 * The checks the signed-in checker recorded, newest first.
 *
 * Deliberately NOT built on {@link usePaginatedList}, unlike `useAssignments`:
 * that helper infers "there is another page" from a full page having been
 * returned, because those endpoints hide their pagination envelope. This one
 * returns a real `pagination` block with `total` and `total_pages`, so the
 * count is known rather than guessed — and "42 checks" is worth showing a
 * checker, where "there might be more" is not.
 *
 * Self-scoped on the server from `req.auth`; nothing here names a checker, and
 * nothing could. A manager wanting somebody else's checks is a different
 * question with a different endpoint -- `scoped`, below.
 */
export function useMyInspections(page: number, perPage = 20, q?: string, scoped = false) {
  const { data, error, isLoading, mutate } = useSWR(
    // `q` is part of the key so a search does not read a previous term's cache,
    // and `null` rather than "" keeps the two indistinguishable keys apart.
    // `scoped` is in the key too: the two endpoints return different rows for
    // the same caller, and sharing a cache entry would show one as the other.
    ["my-inspections", page, perPage, q?.trim() || null, scoped],
    () =>
      scoped
        ? qualityApi.scopedInspections(page, perPage, q)
        : qualityApi.myInspections(page, perPage, q),
    { keepPreviousData: true },
  );

  return {
    checks: data?.checks ?? [],
    pagination: data?.pagination,
    isLoading,
    error,
    mutate,
  };
}

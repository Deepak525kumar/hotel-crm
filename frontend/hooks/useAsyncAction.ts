"use client";

import { useCallback, useState } from "react";
import { ApiError } from "@/lib/api";

export interface RunOptions<T> {
  /**
   * Distinguishes concurrent actions on one page so each button can show its
   * own spinner: `isPending("start")` vs `isPending("cancel")`. Omit for
   * single-action pages and use `pending`.
   */
  key?: string;
  /** Runs after the action resolves (e.g. SWR `mutate`); its result is ignored. */
  onSuccess?: (result: T) => unknown;
  /** Fallback message when the thrown error is not an {@link ApiError}. */
  errorMessage?: string;
}

const DEFAULT_ERROR = "Something went wrong. Please try again.";

/**
 * Encapsulates the mutation triad repeated across detail pages: clear error →
 * set pending → run → on failure surface the message → always clear pending.
 * The `ApiError` message is preferred; `errorMessage` is the non-API fallback.
 *
 * Returns a stable `run` plus `pending`/`isPending` and the shared `error`
 * (cleared at the start of every `run`, matching the previous per-handler
 * `setError(null)`).
 */
export function useAsyncAction() {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(
      action: () => Promise<T>,
      opts?: RunOptions<T>,
    ): Promise<T | undefined> => {
      setError(null);
      setPendingKey(opts?.key ?? "default");
      let result: T;
      try {
        result = await action();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : (opts?.errorMessage ?? DEFAULT_ERROR),
        );
        setPendingKey(null);
        return undefined;
      }

      // onSuccess runs OUTSIDE the error path on purpose (reported live for
      // absence withdrawal: the absence was withdrawn and an error appeared
      // anyway). Callers pass a cache revalidation here -- `mutate(...)` --
      // and it used to sit inside the same try as the action, so a failed
      // refetch was reported with the ACTION's error message, telling the
      // user the thing they just did had failed when it had succeeded. The
      // action is what `error` speaks for; a stale cache resolves itself on
      // the next revalidation and is not worth contradicting a completed
      // write over.
      try {
        await opts?.onSuccess?.(result);
      } catch {
        // Intentionally silent -- see above.
      } finally {
        setPendingKey(null);
      }
      return result;
    },
    [],
  );

  const isPending = useCallback(
    (key?: string) => (key ? pendingKey === key : pendingKey !== null),
    [pendingKey],
  );

  return { run, error, setError, pending: pendingKey !== null, isPending };
}

"use client";

import { useEffect } from "react";

/**
 * Root error boundary for the App Router. Catches render/runtime errors in the
 * route tree below the root layout and offers a recovery path. Kept dependency-
 * light (inline styles, no design-system imports) so it stays functional even
 * when the error originates in shared UI.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error for observability; the digest correlates with server logs.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 dark:bg-gray-800">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          An unexpected error occurred. You can try again, or head back to the
          dashboard.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

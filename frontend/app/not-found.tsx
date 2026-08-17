"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

/**
 * Branded 404 for unmatched routes.
 *
 * Marked "use client" so its copy can resolve through `t()` -- `useTranslation`
 * reads the `I18nextProvider` context that `LocaleProvider` mounts, which a
 * Server Component cannot see. This page renders inside the root layout, so
 * that provider is present; verified in a browser under `ar` and `de` rather
 * than assumed, since this repo's AGENTS.md warns that this Next.js version's
 * behaviour differs from training data.
 *
 * The sibling `(protected)/loading.tsx` is deliberately NOT converted the same
 * way: it is a Suspense fallback that can paint during streaming before client
 * providers are guaranteed mounted, and its only string is a screen-reader
 * label on a spinner shown for milliseconds -- not worth the risk this page's
 * three visible strings justify.
 */
export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 dark:bg-gray-800">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">404</p>
        <h1 className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("errors.pageNotFound")}
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {t("errors.pageNotFoundDescription")}
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {t("common.goToDashboard")}
          </Link>
        </div>
      </div>
    </div>
  );
}

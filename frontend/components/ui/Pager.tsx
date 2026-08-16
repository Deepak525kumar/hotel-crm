"use client";

// Marked explicitly rather than relying on inheriting a client boundary
// from its importers: this now calls `useTranslation()`, and every current
// caller is already a client component, so the directive documents what was
// already true instead of moving a rendering boundary.
import { Button } from "./Button";
import { useTranslation } from "react-i18next";

export interface PagerProps {
  page: number;
  /** Whether a further page exists (a full page was returned). */
  hasNext: boolean;
  onPageChange: (page: number) => void;
  /** Disables both controls (e.g. while a request is in flight). */
  disabled?: boolean;
}

/**
 * Client-side pager footer shared by every list view. Paging is
 * length-driven (the API's pagination metadata isn't surfaced by `apiFetch`):
 * `hasNext` reflects whether a full page came back.
 */
export function Pager({ page, hasNext, onPageChange, disabled }: PagerProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1 || disabled}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        {t("common.previous")}
      </Button>
      <span className="text-sm text-gray-500 dark:text-gray-400">Page {page}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={!hasNext || disabled}
        onClick={() => onPageChange(page + 1)}
      >
        {t("common.next")}
      </Button>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { notificationsApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Badge, FormError, TextLink } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Notification } from "@/lib/types";
import { useTranslation } from "react-i18next";

const PREVIEW_COUNT = 5;

/**
 * Navbar bell — replaces the "Notifications" sidebar nav item (moved here
 * per explicit request) with an icon + unread badge that opens a compact
 * preview dropdown of the most recent notifications, backed by the same
 * `useNotifications` hook the full `/notifications` page already uses (one
 * shared SWR cache, so marking read here or there stays in sync).
 */
export function NotificationsBell() {
  const { t } = useTranslation();
  const { notifications, unreadCount, mutate } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  const preview = notifications.slice(0, PREVIEW_COUNT);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        className="relative rounded-md p-2 text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 dark:text-gray-400 dark:hover:bg-gray-800"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unreadCount > 0 && (
          <span
            className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-medium text-white"
            aria-hidden
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* A plain labelled region, not role="menu" -- this isn't a menu of
          commands with arrow-key navigation, it's a list of links/buttons,
          so the native semantics of <ul>/<li>/<a>/<button> already describe
          it correctly without taking on ARIA menu's stricter (and here
          unmet) contract. */}
      {open && (
        <div
          aria-label={t("nav.notifications")}
          className="absolute end-0 z-50 mt-2 w-80 max-w-[90vw] rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("nav.notifications")}</span>
            {unreadCount > 0 && (
              <Badge tone="info">{unreadCount} unread</Badge>
            )}
          </div>

          {preview.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {preview.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onClose={() => setOpen(false)}
                  onMarkedRead={() => mutate()}
                />
              ))}
            </ul>
          )}

          <div className="border-t border-gray-100 px-4 py-2 text-center dark:border-gray-800">
            <TextLink href="/notifications" onClick={() => setOpen(false)} className="text-sm">
              View all notifications
            </TextLink>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Own `useAsyncAction()` instance per row -- a single shared instance across
 * every preview row can't distinguish "row A's request is pending" from
 * "row B's request is pending" (it tracks one pendingKey at a time), so two
 * concurrent "Mark as read" clicks on different rows would incorrectly
 * re-enable each other's button mid-flight.
 */
function NotificationRow({
  notification: n,
  onClose,
  onMarkedRead,
}: {
  notification: Notification;
  onClose: () => void;
  onMarkedRead: () => void;
}) {
  const markRead = useAsyncAction();

  const onMarkRead = () =>
    markRead.run(() => notificationsApi.markAsRead(n.id), {
      onSuccess: onMarkedRead,
      errorMessage: "Failed to mark as read. Please try again.",
    });

  return (
    <li
      className={cn(
        "border-b border-gray-50 px-4 py-3 last:border-b-0 dark:border-gray-800",
        !n.is_read && "bg-blue-50/50 dark:bg-blue-950/40",
      )}
    >
      <Link
        href={`/notifications/${n.id}`}
        onClick={onClose}
        className="block text-sm font-medium text-gray-900 hover:underline dark:text-gray-100"
      >
        {n.title}
      </Link>
      <p className="mt-0.5 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">{n.message}</p>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-gray-400 dark:text-gray-500">{formatDateTime(n.created_at)}</span>
        {!n.is_read && (
          <button
            type="button"
            onClick={onMarkRead}
            disabled={markRead.pending}
            className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
          >
            Mark as read
          </button>
        )}
      </div>
      <FormError className="mt-1 text-xs">{markRead.error}</FormError>
    </li>
  );
}

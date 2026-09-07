"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePathname } from "next/navigation";
import { MessageCircle, X, Maximize2 } from "lucide-react";
import Link from "next/link";
import { useChatbotStore } from "@/stores/chatbot";
import { ChatPanel } from "./ChatPanel";

/**
 * The floating assistant, available on every authenticated page.
 *
 * RENDERS NOTHING AT ALL when the backend does not serve the chatbot routes,
 * which is its state in production today (`FEATURE_CHATBOT` is off). The
 * probe runs once per session and failure is silent — a worker who cannot use
 * the assistant should not see a button that errors, and should not be told
 * an unreleased feature exists.
 */
export function ChatWidget() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { available, open, probe, setOpen } = useChatbotStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void probe();
  }, [probe]);

  // Escape closes, and focus returns to the button that opened it —
  // otherwise focus is left on a removed node and keyboard users are
  // stranded at the top of the document.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // The dedicated page already IS the assistant; a floating copy of it on top
  // would be two views of one conversation competing for the same input.
  const onAssistantPage = pathname?.startsWith("/assistant");

  if (available !== true || onAssistantPage) return null;

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={t("chatbot.title", "Assistant")}
          className="fixed bottom-24 right-4 z-40 flex h-[min(32rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 sm:right-6"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <p className="text-sm font-semibold">{t("chatbot.title", "Assistant")}</p>
            <div className="flex items-center gap-1">
              <Link
                href="/assistant"
                onClick={() => setOpen(false)}
                aria-label={t("chatbot.openFull", "Open full page")}
                className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label={t("chatbot.close", "Close")}
                className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* min-h-0 so the transcript scrolls inside the panel instead of
              pushing the composer off the bottom. */}
          <div className="min-h-0 flex-1">
            <ChatPanel compact />
          </div>
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? t("chatbot.close", "Close") : t("chatbot.title", "Assistant")}
        className="fixed bottom-5 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:right-6 dark:focus:ring-offset-gray-900"
      >
        {open ? (
          <X className="h-6 w-6" aria-hidden="true" />
        ) : (
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
        )}
      </button>
    </>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePathname } from "next/navigation";
import { X, Maximize2 } from "lucide-react";
import { ZelleMark } from "./ZelleMark";
import Link from "next/link";
import { useChatbotStore } from "@/stores/chatbot";
import { ChatPanel } from "./ChatPanel";

/**
 * The floating assistant, available on every authenticated page.
 *
 * RENDERS NOTHING AT ALL when the backend does not serve the chatbot routes.
 * That was production's state until 2026-09-09, when `FEATURE_CHATBOT` was
 * enabled; it still holds wherever the flag is off, and for any user the
 * backend does not serve the routes to. The
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
          aria-label={t("chatbot.title", "Zelle")}
          /* MOBILE BROWSERS, and two things they do differently.
             `100vh` on iOS Safari and Android Chrome is the height of the
             viewport WITHOUT the browser's own collapsing toolbars, so a
             panel sized from it extends underneath them and its composer --
             the input you type into -- sits off-screen. `100dvh` is that
             height as it actually is at any moment. Used alone rather than
             paired with a `100vh` class: two `h-[...]` utilities both get
             emitted and which wins depends on the order Tailwind writes them
             into the stylesheet, not the order they appear here -- so the
             "fallback" would be a coin toss. `dvh` is supported by every
             browser this app targets (iOS 15.4+, Chrome 108+).
             The bottom offset also clears the home-indicator inset, so the
             panel is not pinned under it on a notched phone. */
          className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom,0px))] right-4 z-40 flex h-[min(32rem,calc(100dvh-9rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 sm:right-6"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ZelleMark className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              {t("chatbot.title", "Zelle")}
            </p>
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
        aria-label={open ? t("chatbot.close", "Close") : t("chatbot.title", "Zelle")}
        /* THE LAUNCHER, reported invisible on a mobile browser (2026-09-10).
           At `bottom-5` (20px) a 56px button sits directly under the browser
           chrome that iOS Safari and Android Chrome overlay along the bottom
           edge, and under the home indicator on a notched phone -- so the one
           control that opens the assistant is the one thing covered.
           `env(safe-area-inset-bottom)` is 0 everywhere it does not apply, so
           this changes nothing on desktop. */
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:right-6 dark:focus:ring-offset-gray-900"
      >
        {open ? (
          <X className="h-6 w-6" aria-hidden="true" />
        ) : (
          <ZelleMark className="h-6 w-6" />
        )}
      </button>
    </>
  );
}

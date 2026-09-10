"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { useChatbotStore } from "@/stores/chatbot";
import { ChatPanel } from "@/components/chatbot/ChatPanel";
import { ZelleMark } from "@/components/chatbot/ZelleMark";

/**
 * The full-page assistant.
 *
 * Shares the store with the floating widget, so a question started in one
 * continues in the other rather than opening a second conversation (and a
 * second budget counter) on the backend.
 *
 * Redirects away when the feature is not served, rather than rendering an
 * empty shell: a URL that resolves to a dead page is worse than one that
 * does not resolve, and it would confirm an unreleased feature exists.
 */
export default function AssistantPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { available, probe } = useChatbotStore();

  useEffect(() => {
    void probe();
  }, [probe]);

  useEffect(() => {
    if (available === false) router.replace("/dashboard");
  }, [available, router]);

  if (available !== true) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        {available === null ? t("common.loading", "Loading…") : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-10rem)] max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <ZelleMark className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          {t("chatbot.title", "Zelle")}
        </h1>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {t(
            "chatbot.subtitle",
            "Answers about your own shifts, contract, payslips and messages.",
          )}
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <ChatPanel />
      </div>
    </div>
  );
}

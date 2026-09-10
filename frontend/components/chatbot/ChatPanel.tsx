"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, RotateCcw, Send, X } from "lucide-react";
import { useChatbotStore } from "@/stores/chatbot";
import type { ChatMessage } from "@/lib/types";

/**
 * The conversation surface. Rendered both as a full page and inside the
 * floating widget, which is why it fills its container rather than setting
 * its own height.
 *
 * Layout follows the shape people already know from chat assistants: a
 * scrolling transcript, quick-reply chips when there is nothing to scroll,
 * and a composer pinned to the bottom that grows with the text.
 */
export function ChatPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { messages, commands, sending, send, runCommand, confirm, cancelConfirmation, retry } =
    useChatbotStore();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Follow the conversation. `sending` is a dependency too so the typing
  // indicator is scrolled into view, not just the finished reply.
  useEffect(() => {
    // Feature-checked, not just null-checked. `scrollIntoView` is absent in
    // jsdom and in some embedded webviews; an exception thrown from an effect
    // unmounts the tree, so the whole conversation would disappear rather
    // than merely failing to scroll.
    const end = endRef.current;
    if (typeof end?.scrollIntoView === "function") {
      end.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, sending]);

  const submit = () => {
    const text = draft;
    setDraft("");
    void send(text);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-label={t("chatbot.transcript", "Conversation")}
      >
        {messages.length === 0 ? (
          <EmptyState
            compact={compact}
            commands={commands}
            onPick={(id, label) => void runCommand(id, label)}
            disabled={sending}
          />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {messages.map((m) => (
              <Bubble
                key={m.id}
                message={m}
                onConfirm={() =>
                  m.pendingConfirmation && void confirm(m.id, m.pendingConfirmation.token)
                }
                onCancel={() => cancelConfirmation(m.id)}
                onRetry={retry}
                retryLabel={t("chatbot.retry", "Try again")}
              />
            ))}
            {sending && <Typing />}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line. The convention
              // people already expect from every chat surface.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={t("chatbot.placeholder", "Ask about your shifts, contract or messages…")}
            aria-label={t("chatbot.inputLabel", "Message")}
            className="max-h-40 min-h-[42px] flex-1 resize-y rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <button
            type="button"
            onClick={submit}
            disabled={sending || draft.trim().length === 0}
            aria-label={t("chatbot.send", "Send")}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  compact,
  commands,
  onPick,
  disabled,
}: {
  compact: boolean;
  commands: { id: string; label: string }[];
  onPick: (id: string, label: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-5 text-center">
      <div>
        <p className={compact ? "text-base font-semibold" : "text-xl font-semibold"}>
          {t("chatbot.greeting", "How can I help?")}
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("chatbot.greetingHint", "Ask a question, or pick one below.")}
        </p>
      </div>

      {/* Chips are not decoration: each one is answered without calling a
          model at all, so they are both instant and free. Shown prominently
          for exactly that reason. */}
      {commands.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {commands.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(c.id, c.label)}
              className="rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-sm text-gray-700 transition hover:border-blue-500 hover:text-blue-700 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-blue-400 dark:hover:text-blue-300"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Bubble({
  message,
  onConfirm,
  onCancel,
  onRetry,
  retryLabel,
}: {
  message: ChatMessage;
  onConfirm: () => void;
  onCancel: () => void;
  /** Absent when the message carries nothing safe to resend. */
  onRetry?: (messageId: string) => void;
  retryLabel: string;
}) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div className={isUser ? "max-w-[85%]" : "w-full max-w-[95%]"}>
        <div
          className={[
            "rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words",
            isUser
              ? "bg-blue-600 text-white"
              : message.failed
                ? "border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
          ].join(" ")}
        >
          {message.failed && (
            <AlertTriangle className="mr-1.5 inline h-4 w-4 align-[-3px]" aria-hidden="true" />
          )}
          {message.text}

          {/* RETRY, rather than making them type it again.
              The old failure said "please try again", which on a phone
              mid-shift meant retyping the whole message they had just
              watched fail. The request is still held, so the button resends
              it. Absent on a failed confirmation, which is not safe to
              replay -- see the store. */}
          {message.failed && message.retry && onRetry && (
            <button
              type="button"
              onClick={() => onRetry(message.id)}
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-600 dark:text-amber-200 dark:hover:bg-amber-900"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {retryLabel}
            </button>
          )}
        </div>

        {message.pendingConfirmation && <ConfirmBar
          resolved={message.resolved}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />}
      </div>
    </div>
  );
}

/**
 * The approval control for a high-risk write.
 *
 * NOTHING HAS BEEN WRITTEN when this renders — the assistant has only
 * proposed. The wording says so plainly rather than relying on the user to
 * infer it from the presence of buttons, and the summary above it is
 * rendered by the server from the exact arguments the confirmation token
 * authorises, so what is read is what runs.
 *
 * Once answered the buttons are replaced, not merely disabled: a control
 * that still looks pressable after the decision invites a second click on
 * something that has already happened.
 */
function ConfirmBar({
  resolved,
  onConfirm,
  onCancel,
}: {
  resolved?: "confirmed" | "cancelled";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  if (resolved) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        {resolved === "confirmed" ? (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {resolved === "confirmed"
          ? t("chatbot.confirmed", "Confirmed")
          : t("chatbot.cancelled", "Cancelled")}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onConfirm}
        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
      >
        {t("chatbot.confirm", "Confirm")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        {t("chatbot.cancel", "Cancel")}
      </button>
    </div>
  );
}

function Typing() {
  const { t } = useTranslation();
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl bg-gray-100 px-4 py-3 dark:bg-gray-800">
        <span className="sr-only">{t("chatbot.thinking", "Thinking…")}</span>
        <span className="flex gap-1" aria-hidden="true">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 dark:bg-gray-500"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

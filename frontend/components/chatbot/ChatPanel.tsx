"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  History,
  RotateCcw,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
import { Composer } from "./Composer";
import { conversationAsText, useChatbotStore } from "@/stores/chatbot";
import type { ChatMessage, ChatbotConversationSummary } from "@/lib/types";

/**
 * The conversation surface. Rendered both as a full page and inside the
 * floating widget, which is why it fills its container rather than setting
 * its own height.
 *
 * Layout follows the shape people already know from chat assistants: a
 * scrolling transcript, quick-reply chips when there is nothing to scroll,
 * and a composer pinned to the bottom that grows with the text.
 *
 * THE TOOLBAR (2026-09-15). Two requests from real use were refused because
 * nothing on screen could do them: "I want previous chats" and "make me that
 * chat copy". History lists the person's own conversations from the last 30
 * days and reads one back; Copy puts the conversation on the clipboard; New
 * chat leaves the current one. The assistant is told these exist, so it can
 * point at them instead of saying no.
 */
export function ChatPanel({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const store = useChatbotStore();
  const { messages, commands, sending, send, runCommand, confirm, cancelConfirmation, retry } = store;
  // Defaulted: tests and older callers mock the store with the chat fields
  // only, and a panel that crashed on a missing view would take the whole
  // conversation down with it.
  const view = store.view ?? "chat";
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
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

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const submit = () => {
    const text = draft;
    setDraft("");
    void send(text);
    inputRef.current?.focus();
  };

  const copySource =
    view === "transcript" ? (store.transcript?.messages ?? []) : view === "chat" ? messages : [];

  const copy = async () => {
    // The clipboard API is missing on plain-http origins and some embedded
    // webviews. Nothing sensible can be done there, and throwing would be
    // worse than the button doing nothing.
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(conversationAsText(copySource));
      setCopied(true);
    } catch {
      // Permission refused by the browser; leave the label unchanged.
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-gray-200 px-2 py-1 dark:border-gray-700">
        {view !== "chat" ? (
          <ToolbarButton
            icon={ArrowLeft}
            label={t("chatbot.historyBack", "Back to chat")}
            onClick={() => store.backToChat?.()}
          />
        ) : null}
        <div className="flex-1" />
        <ToolbarButton
          icon={History}
          label={t("chatbot.history", "History")}
          onClick={() => void store.openHistory?.()}
        />
        <ToolbarButton
          icon={copied ? Check : Copy}
          label={copied ? t("chatbot.copied", "Copied") : t("chatbot.copy", "Copy")}
          disabled={copySource.length === 0}
          onClick={() => void copy()}
        />
        <ToolbarButton
          icon={SquarePen}
          label={t("chatbot.newChat", "New chat")}
          disabled={sending}
          onClick={() => store.newChat?.()}
        />
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-label={t("chatbot.transcript", "Conversation")}
      >
        {view === "history" ? (
          <HistoryList
            items={store.history ?? []}
            loading={Boolean(store.historyLoading)}
            failed={Boolean(store.historyFailed)}
            locale={i18n?.language ?? "en"}
            onOpen={(id) => void store.openTranscript?.(id)}
          />
        ) : view === "transcript" ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {store.historyFailed ? (
              <p className="text-sm text-gray-500">{t("chatbot.historyFailed", "Could not load your conversations.")}</p>
            ) : null}
            {(store.transcript?.messages ?? []).map((m, i) => (
              <Bubble key={`t${i}`} message={{ id: `t${i}`, role: m.role, text: m.text }} retryLabel="" />
            ))}
          </div>
        ) : messages.length === 0 ? (
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

      {view === "chat" ? (
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          sending={sending}
          // `i18n` is optional-chained: it is absent wherever `useTranslation`
          // is mocked to just `{ t }`, and a composer that throws would take the
          // whole conversation down with it.
          language={i18n?.language?.split('-')[0] ?? 'en'}
        />
      ) : null}
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

function HistoryList({
  items,
  loading,
  failed,
  locale,
  onOpen,
}: {
  items: ChatbotConversationSummary[];
  loading: boolean;
  failed: boolean;
  locale: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();

  // Berlin, like every other time on this platform: a conversation at 00:30
  // belongs to the day the person lived it.
  const when = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      <p className="text-sm font-semibold">{t("chatbot.historyTitle", "Earlier conversations")}</p>
      {loading ? <Typing /> : null}
      {!loading && failed ? (
        <p className="text-sm text-gray-500">{t("chatbot.historyFailed", "Could not load your conversations.")}</p>
      ) : null}
      {!loading && !failed && items.length === 0 ? (
        <p className="text-sm text-gray-500">{t("chatbot.historyEmpty", "No conversations from the last 30 days.")}</p>
      ) : null}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item.id)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-left transition hover:border-blue-500 dark:border-gray-700 dark:hover:border-blue-400"
        >
          <span className="block text-xs text-gray-500 dark:text-gray-400">{when(item.started_at)}</span>
          <span className="block truncate text-sm">{item.opening ?? "…"}</span>
        </button>
      ))}
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

/**
 * The ONE link an assistant reply may carry: the pre-filled New user form.
 *
 * Deliberately an allowlist of a single internal path, not general
 * linkification. Assistant text can contain model prose, and a model can be
 * talked into writing any URL; turning arbitrary text into clickable links
 * would hand a prompt injection a phishing button. The form link is produced
 * by `users.new_account_link` in code, and nothing else is made clickable.
 */
const FORM_LINK = /(\/users\/new#\S+)/;

function ReplyText({ text }: { text: string }) {
  const { t } = useTranslation();
  if (!FORM_LINK.test(text)) return <>{text}</>;
  return (
    <>
      {text.split(FORM_LINK).map((part, i) =>
        FORM_LINK.test(part) ? (
          <Link
            key={i}
            href={part}
            className="font-medium text-blue-700 underline dark:text-blue-300"
          >
            {t("chatbot.openForm", "Open the filled-in New user form")}
          </Link>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
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
  onConfirm?: () => void;
  onCancel?: () => void;
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
          {isUser ? message.text : <ReplyText text={message.text} />}

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

        {message.pendingConfirmation && onConfirm && onCancel && <ConfirmBar
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

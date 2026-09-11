"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Mic, Square } from "lucide-react";
import { useSpeechInput } from "@/hooks/use-speech-input";

/**
 * The composer.
 *
 * WHAT WAS WRONG WITH THE OLD ONE. A bordered textarea sat beside a separate
 * square button, both 42px tall, with `resize-y` left on — so the field had a
 * drag handle in its corner, could be dragged out of alignment with the
 * button next to it, and never grew on its own no matter how much was typed.
 * Three separate rectangles reading as three separate controls, for what is
 * one action.
 *
 * It is now ONE SURFACE: a single rounded container that owns the focus ring,
 * with the field and its buttons inside it. That is the shape people know
 * from every assistant they have used, and it means focus is expressed once
 * rather than by whichever rectangle happens to have it.
 *
 * IT GROWS WITH THE TEXT, up to a cap, then scrolls. A worker dictating three
 * sentences should see three sentences; a manager pasting a paragraph should
 * not lose the send button off the bottom of a phone.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  sending,
  language,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  sending: boolean;
  /** App locale, so dictation listens in the right language. */
  language: string;
}) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // What the field held when dictation began. Speech results replace only
  // what has been dictated this session, so a worker can type "sick on " and
  // then say the date without the typed half being overwritten.
  const baseRef = useRef("");

  const speech = useSpeechInput({
    language,
    onTranscript: (text) => {
      const base = baseRef.current;
      onChange(base ? `${base.replace(/\s*$/, "")} ${text}` : text);
    },
  });

  // Grow to fit, to a limit. Measured from `scrollHeight`, which needs the
  // height reset first or the box only ever ratchets upward.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !sending;

  const toggleDictation = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    baseRef.current = value;
    speech.start();
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="mx-auto w-full max-w-3xl">
        {speech.error && (
          <p
            role="status"
            className="mb-2 px-1 text-xs text-amber-700 dark:text-amber-400"
          >
            {speech.error === "denied"
              ? t(
                  "chatbot.micDenied",
                  "Microphone access is blocked. Allow it in your browser settings to dictate."
                )
              : t("chatbot.micFailed", "Dictation did not work. You can type instead.")}
          </p>
        )}

        {/* ONE container owns the border and the focus ring, so the field and
            its buttons read as a single control rather than three. */}
        <div className="flex items-end gap-1 rounded-2xl border border-gray-300 bg-white p-1.5 shadow-sm transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — the convention
              // every chat surface already taught them.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSubmit();
              }
            }}
            rows={1}
            disabled={sending}
            placeholder={
              speech.listening
                ? t("chatbot.listening", "Listening…")
                : t("chatbot.placeholder", "Ask about your shifts, contract or messages…")
            }
            aria-label={t("chatbot.inputLabel", "Message")}
            // `resize-none`: the container sizes itself, and a drag handle
            // here let the field be pulled out of line with its own buttons.
            className="max-h-40 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-60 dark:text-gray-100 dark:placeholder:text-gray-500"
          />

          {speech.supported && (
            <button
              type="button"
              onClick={toggleDictation}
              disabled={sending}
              aria-label={
                speech.listening
                  ? t("chatbot.stopDictation", "Stop dictating")
                  : t("chatbot.dictate", "Dictate a message")
              }
              aria-pressed={speech.listening}
              className={[
                "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition",
                speech.listening
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200",
                "disabled:cursor-not-allowed disabled:opacity-50",
              ].join(" ")}
            >
              {speech.listening ? (
                <>
                  {/* A ring that keeps pulsing while the microphone is open.
                      Someone must be able to tell at a glance that they are
                      being listened to, from across a room. */}
                  <span className="absolute h-9 w-9 animate-ping rounded-full bg-red-500/40 motion-reduce:hidden" />
                  <Square className="relative h-3.5 w-3.5 fill-current" aria-hidden="true" />
                </>
              ) : (
                <Mic className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label={t("chatbot.send", "Send")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-1.5 px-1 text-[11px] text-gray-400 dark:text-gray-500">
          {t("chatbot.enterHint", "Enter to send, Shift+Enter for a new line")}
        </p>
      </div>
    </div>
  );
}

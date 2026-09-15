import { create } from "zustand";
import { chatbotApi } from "@/lib/api";
import type {
  ChatMessage,
  ChatbotCommand,
  ChatbotConversationSummary,
  ChatbotTranscript,
} from "@/lib/types";

/**
 * Chat state, shared by the full page and the floating widget.
 *
 * ONE store for both surfaces on purpose: a worker who starts a question in
 * the widget and then opens the full page should find the same conversation,
 * not a second empty one. Two stores would also mean two conversations on the
 * backend and two budget counters.
 *
 * The LIVE conversation's bubbles live here. Earlier conversations are no
 * longer only in this tab: since 2026-09-08 the backend keeps transcripts
 * encrypted for 30 days (`OD-CHAT-008`), and since 2026-09-15 the person can
 * read their own back through History. They are still never written to
 * localStorage -- the server already holds them, and a second copy in the
 * browser would outlive the retention window the server enforces.
 */

let messageSeq = 0;
const nextId = () => `m${++messageSeq}`;

/** What the panel is showing: the live chat, the History list, or one past conversation. */
export type ChatView = "chat" | "history" | "transcript";

interface ChatbotState {
  /** null = not probed yet. false = the feature is off or not permitted. */
  available: boolean | null;
  open: boolean;
  conversationId: string | null;
  commands: ChatbotCommand[];
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;

  view: ChatView;
  history: ChatbotConversationSummary[] | null;
  historyLoading: boolean;
  historyFailed: boolean;
  transcript: ChatbotTranscript | null;

  probe: () => Promise<void>;
  setOpen: (open: boolean) => void;
  send: (text: string) => Promise<void>;
  runCommand: (commandId: string, label: string) => Promise<void>;
  confirm: (messageId: string, token: string) => Promise<void>;
  cancelConfirmation: (messageId: string) => void;
  /** Resend the request behind a failed message, replacing that message. */
  retry: (messageId: string) => Promise<void>;
  reset: () => void;

  /** Show the person's own conversations from the last 30 days. */
  openHistory: () => Promise<void>;
  /** Read one of them back. */
  openTranscript: (conversationId: string) => Promise<void>;
  backToChat: () => void;
  /** Leave the current conversation and start clean on the next message. */
  newChat: () => void;
}

/**
 * A conversation as plain text, for the Copy button.
 *
 * Reported 2026-09-15: asked to "make me that chat copy", the assistant said
 * the platform does not support copying chat history. It could not -- nothing
 * on screen did. Labelled lines rather than raw bubbles, so it pastes into a
 * message or an email and still reads as who said what.
 */
export function conversationAsText(
  items: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
  assistantName = "Zelle",
): string {
  return items
    .filter((m) => m.text.trim().length > 0)
    .map((m) => `${m.role === "user" ? "You" : assistantName}: ${m.text.trim()}`)
    .join("\n\n");
}

export const useChatbotStore = create<ChatbotState>((set, get) => ({
  available: null,
  open: false,
  conversationId: null,
  commands: [],
  messages: [],
  sending: false,
  error: null,

  view: "chat",
  history: null,
  historyLoading: false,
  historyFailed: false,
  transcript: null,

  /**
   * Probe once. Failure means "no assistant", never an error surfaced to a
   * worker who never asked for one.
   */
  probe: async () => {
    if (get().available !== null) return;
    // ONE request, not two. This used to call isAvailable() -- which fetches
    // /chatbot/commands and discards it -- and then commands(), fetching the
    // same endpoint again. See probeCommands() for why the second round trip
    // was worth removing.
    const commands = await chatbotApi.probeCommands();
    // Chips are a convenience; an empty list still leaves free text working.
    set({ available: commands !== null, commands: commands ?? [] });
  },

  setOpen: (open) => set({ open }),

  reset: () =>
    set({ conversationId: null, messages: [], error: null, sending: false, view: "chat", transcript: null }),

  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().sending) return;
    await exchange(set, get, { text: trimmed }, trimmed);
  },

  /**
   * A tapped chip. Sends `command_id`, never the label text — the backend
   * resolves it by id with no parsing at all, which is both cheaper and
   * safer than round-tripping a string through the matcher.
   */
  runCommand: async (commandId, label) => {
    if (get().sending) return;
    await exchange(set, get, { commandId }, label);
  },

  /**
   * Approve a proposed high-risk write.
   *
   * Sends ONLY the token. The call being confirmed is held server-side, so
   * there is nothing here that could differ from what the user was shown.
   */
  confirm: async (messageId, token) => {
    if (get().sending) return;
    markResolved(set, messageId, "confirmed");
    await exchange(set, get, { confirmToken: token }, null);
  },

  /**
   * Resend what failed.
   *
   * The failed bubble is REMOVED first rather than left above the new
   * attempt: two "I could not answer that" bubbles for one question read as
   * two failures, and the user's own message is still there above it saying
   * what was asked.
   *
   * No echo is passed, because the question is already in the transcript --
   * echoing again would show it twice.
   */
  retry: async (messageId) => {
    const message = get().messages.find((m) => m.id === messageId);
    if (!message?.retry || get().sending) return;

    const input = message.retry;
    set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) }));
    await exchange(set, get, input, null);
  },

  /**
   * Decline. Purely local: no request is made, because nothing was ever
   * written. The parked call expires on its own (5 minutes), so there is no
   * cancellation endpoint to call and inventing one would imply state that
   * does not exist.
   */
  cancelConfirmation: (messageId) => {
    markResolved(set, messageId, "cancelled");
    set((s) => ({
      messages: [
        ...s.messages,
        { id: nextId(), role: "assistant", text: "Cancelled. Nothing was changed." },
      ],
    }));
  },

  /**
   * Fetched every time it is opened rather than cached: the conversation the
   * person just had should be at the top, and a stale list is exactly the
   * "where did my chat go" confusion History exists to remove.
   */
  openHistory: async () => {
    set({ view: "history", historyLoading: true, historyFailed: false, transcript: null });
    try {
      const history = await chatbotApi.listConversations();
      set({ history, historyLoading: false });
    } catch {
      set({ history: null, historyLoading: false, historyFailed: true });
    }
  },

  openTranscript: async (conversationId) => {
    set({ view: "transcript", transcript: null, historyLoading: true, historyFailed: false });
    try {
      const transcript = await chatbotApi.getTranscript(conversationId);
      set({ transcript, historyLoading: false });
    } catch {
      set({ historyLoading: false, historyFailed: true });
    }
  },

  backToChat: () => set({ view: "chat", transcript: null, historyFailed: false }),

  newChat: () =>
    set({ conversationId: null, messages: [], error: null, view: "chat", transcript: null }),
}));

function markResolved(
  set: (fn: (s: ChatbotState) => Partial<ChatbotState>) => void,
  messageId: string,
  resolved: "confirmed" | "cancelled",
) {
  set((s) => ({
    messages: s.messages.map((m) => (m.id === messageId ? { ...m, resolved } : m)),
  }));
}

/**
 * One turn, start to finish.
 *
 * `echo` is what to show as the user's bubble, or null for a confirmation
 * (which has no user-authored text — showing the token would be meaningless
 * and showing nothing is honest).
 */
async function exchange(
  set: (fn: (s: ChatbotState) => Partial<ChatbotState>) => void,
  get: () => ChatbotState,
  input: { text?: string; commandId?: string; confirmToken?: string },
  echo: string | null,
) {
  set((s) => ({
    sending: true,
    error: null,
    // Sending always returns to the live chat: a message typed while reading
    // History belongs to the conversation in progress, not the one on screen.
    view: "chat",
    transcript: null,
    messages: echo
      ? [...s.messages, { id: nextId(), role: "user" as const, text: echo }]
      : s.messages,
  }));

  try {
    let conversationId = get().conversationId;
    if (!conversationId) {
      conversationId = (await chatbotApi.startConversation()).id;
      set(() => ({ conversationId }));
    }

    const turn = await chatbotApi.sendMessage(conversationId, input);

    // A CONVERSATION THE SERVER HAS CLOSED IS NOT REUSABLE.
    //
    // `status` has always been on the turn and was always ignored here, so
    // the id was held until something called reset(). Once the server closed
    // the conversation -- a budget cap, the turn ceiling -- every later
    // message was posted straight back to the dead id and refused, which is
    // how a production user got "You do not have access to that." three
    // times in a row for "hello" and "how are you" (2026-09-12). The server
    // now says something true in that case, but the client is what breaks
    // the loop: dropping the id means the NEXT message opens a fresh
    // conversation instead of knocking on the closed one forever.
    //
    // The messages already on screen are deliberately kept. The person can
    // still read what they asked; only the server-side thread restarts.
    if (turn.status && turn.status !== "IN_PROGRESS") {
      set(() => ({ conversationId: null }));
    }

    set((s) => ({
      sending: false,
      messages: [
        ...s.messages,
        {
          id: nextId(),
          role: "assistant" as const,
          text: turn.reply,
          route: turn.route,
          pendingConfirmation: turn.pendingConfirmation,
        },
      ],
    }));
  } catch (err) {
    // Rendered as a failed bubble rather than a toast: the question stays
    // visible above it, so a worker can see what was being answered,
    // instead of a banner that disappears.
    //
    // AND IT CARRIES WHAT TO RETRY. The comment here used to say a worker
    // could "retry" -- which meant retyping the whole message, on a phone,
    // mid-shift, having just watched it fail. `retry` holds the exact input
    // that failed so the bubble can offer a button that resends it.
    set((s) => ({
      sending: false,
      error: err instanceof Error ? err.message : "Something went wrong.",
      messages: [
        ...s.messages,
        {
          id: nextId(),
          role: "assistant" as const,
          text: "I could not answer that just now.",
          failed: true,
          // The original request, verbatim -- a chip tap resends the chip,
          // not its label, so this is the input rather than the echo.
          //
          // A failed CONFIRMATION is deliberately not retryable: the pending
          // call may already have been cleared server-side, so resending the
          // token would either do nothing or claim to retry something that
          // is no longer there. Those turns keep the plain failure message
          // and the person can ask again.
          ...(input.text || input.commandId
            ? { retry: { ...(input.text ? { text: input.text } : {}), ...(input.commandId ? { commandId: input.commandId } : {}) } }
            : {}),
        },
      ],
    }));
  }
}

import { create } from "zustand";
import { chatbotApi } from "@/lib/api";
import type { ChatMessage, ChatbotCommand } from "@/lib/types";

/**
 * Chat state, shared by the full page and the floating widget.
 *
 * ONE store for both surfaces on purpose: a worker who starts a question in
 * the widget and then opens the full page should find the same conversation,
 * not a second empty one. Two stores would also mean two conversations on the
 * backend and two budget counters.
 *
 * The message list lives HERE and nowhere else. Conversation transcripts are
 * deliberately not persisted server-side (`OD-CHAT-008` is open), so these
 * bubbles exist only for as long as the tab does. That is the intended
 * behaviour, not a limitation to work around with localStorage — writing them
 * to the browser would create exactly the transcript store the backend
 * declines to keep.
 */

let messageSeq = 0;
const nextId = () => `m${++messageSeq}`;

interface ChatbotState {
  /** null = not probed yet. false = the feature is off or not permitted. */
  available: boolean | null;
  open: boolean;
  conversationId: string | null;
  commands: ChatbotCommand[];
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;

  probe: () => Promise<void>;
  setOpen: (open: boolean) => void;
  send: (text: string) => Promise<void>;
  runCommand: (commandId: string, label: string) => Promise<void>;
  confirm: (messageId: string, token: string) => Promise<void>;
  cancelConfirmation: (messageId: string) => void;
  reset: () => void;
}

export const useChatbotStore = create<ChatbotState>((set, get) => ({
  available: null,
  open: false,
  conversationId: null,
  commands: [],
  messages: [],
  sending: false,
  error: null,

  /**
   * Probe once. Failure means "no assistant", never an error surfaced to a
   * worker who never asked for one.
   */
  probe: async () => {
    if (get().available !== null) return;
    const available = await chatbotApi.isAvailable();
    set({ available });
    if (!available) return;
    try {
      set({ commands: await chatbotApi.commands() });
    } catch {
      // Chips are a convenience; free text still works without them.
      set({ commands: [] });
    }
  },

  setOpen: (open) => set({ open }),

  reset: () =>
    set({ conversationId: null, messages: [], error: null, sending: false }),

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
    // visible above it, so a worker can see what was being answered and
    // retry, instead of a banner that disappears.
    set((s) => ({
      sending: false,
      error: err instanceof Error ? err.message : "Something went wrong.",
      messages: [
        ...s.messages,
        {
          id: nextId(),
          role: "assistant" as const,
          text: "I could not answer that just now. Please try again.",
          failed: true,
        },
      ],
    }));
  }
}

import { create } from 'zustand';
import { api } from '@/lib/api';
import type { ChatbotCommandDto, ChatbotTurnDto } from '@/types/api';

/**
 * Chat state for the worker app.
 *
 * MESSAGES LIVE HERE AND NOWHERE ELSE. Conversation transcripts are
 * deliberately not persisted server-side (`OD-CHAT-008` is open) and
 * `ADR-074` §5 depends on that: because no history is ever replayed into a
 * prompt, hostile text stored in the platform cannot be read back and
 * obeyed. Writing these bubbles to SecureStore or AsyncStorage would create
 * exactly the transcript store the backend declines to keep, so they last
 * only as long as the screen does. That is the intended behaviour.
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  route?: ChatbotTurnDto['route'];
  pendingConfirmation?: ChatbotTurnDto['pendingConfirmation'];
  resolved?: 'confirmed' | 'cancelled';
  failed?: boolean;
}

let seq = 0;
const nextId = () => `m${++seq}`;

interface ChatbotState {
  /** null = not probed yet. false = the feature is off or not permitted. */
  available: boolean | null;
  conversationId: string | null;
  commands: ChatbotCommandDto[];
  messages: ChatMessage[];
  sending: boolean;

  probe: () => Promise<void>;
  send: (text: string) => Promise<void>;
  runCommand: (commandId: string, label: string) => Promise<void>;
  confirm: (messageId: string, token: string) => Promise<void>;
  cancelConfirmation: (messageId: string) => void;
  reset: () => void;
}

export const useChatbotStore = create<ChatbotState>((set, get) => ({
  available: null,
  conversationId: null,
  commands: [],
  messages: [],
  sending: false,

  probe: async () => {
    if (get().available !== null) return;
    const available = await api.chatbot.isAvailable();
    set({ available });
    if (!available) return;
    try {
      set({ commands: await api.chatbot.commands() });
    } catch {
      // Chips are a convenience; free text still works without them.
      set({ commands: [] });
    }
  },

  reset: () => set({ conversationId: null, messages: [], sending: false }),

  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().sending) return;
    await exchange(set, get, { text: trimmed }, trimmed);
  },

  /**
   * A tapped chip sends `command_id`, never the label. The backend resolves
   * it by id with no parsing at all — cheaper and safer than round-tripping
   * a string through the matcher.
   */
  runCommand: async (commandId, label) => {
    if (get().sending) return;
    await exchange(set, get, { commandId }, label);
  },

  /** Approve a proposed write. Sends ONLY the token; the call is held server-side. */
  confirm: async (messageId, token) => {
    if (get().sending) return;
    markResolved(set, messageId, 'confirmed');
    await exchange(set, get, { confirmToken: token }, null);
  },

  /**
   * Decline. Purely local — nothing was written, and the parked call expires
   * on its own, so there is no cancellation endpoint to call. Inventing one
   * would imply state that does not exist.
   */
  cancelConfirmation: (messageId) => {
    markResolved(set, messageId, 'cancelled');
    set((s) => ({
      messages: [
        ...s.messages,
        { id: nextId(), role: 'assistant', text: 'Cancelled. Nothing was changed.' },
      ],
    }));
  },
}));

function markResolved(
  set: (fn: (s: ChatbotState) => Partial<ChatbotState>) => void,
  messageId: string,
  resolved: 'confirmed' | 'cancelled',
) {
  set((s) => ({
    messages: s.messages.map((m) => (m.id === messageId ? { ...m, resolved } : m)),
  }));
}

/** `echo` is the user's bubble text, or null for a confirmation (which has none). */
async function exchange(
  set: (fn: (s: ChatbotState) => Partial<ChatbotState>) => void,
  get: () => ChatbotState,
  input: { text?: string; commandId?: string; confirmToken?: string },
  echo: string | null,
) {
  set((s) => ({
    sending: true,
    messages: echo
      ? [...s.messages, { id: nextId(), role: 'user' as const, text: echo }]
      : s.messages,
  }));

  try {
    // A local const, not the possibly-null store value narrowed across an
    // await. TS narrowing over `let` through an async boundary is fragile
    // and differs between the two apps' compiler settings; this is explicit.
    const existing = get().conversationId;
    const conversationId = existing ?? (await api.chatbot.startConversation()).id;
    if (!existing) set(() => ({ conversationId }));

    const turn = await api.chatbot.sendMessage(conversationId, input);

    set((s) => ({
      sending: false,
      messages: [
        ...s.messages,
        {
          id: nextId(),
          role: 'assistant' as const,
          text: turn.reply,
          route: turn.route,
          pendingConfirmation: turn.pendingConfirmation,
        },
      ],
    }));
  } catch {
    // A failed bubble rather than an alert: the question stays visible above
    // it, so a worker mid-shift can see what was being answered and retry,
    // instead of a dialog that has to be dismissed before they can read it.
    set((s) => ({
      sending: false,
      messages: [
        ...s.messages,
        {
          id: nextId(),
          role: 'assistant' as const,
          text: 'I could not answer that just now. Please try again.',
          failed: true,
        },
      ],
    }));
  }
}

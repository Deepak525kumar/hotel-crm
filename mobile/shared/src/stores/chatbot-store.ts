import { create } from 'zustand';
import { api } from '../lib/api';
import type {
  ChatbotCommandDto,
  ChatbotConversationSummaryDto,
  ChatbotTranscriptDto,
  ChatbotTurnDto,
} from '../types/api';

/**
 * Chat state for the app.
 *
 * THE LIVE CONVERSATION'S BUBBLES LIVE HERE. Earlier conversations are kept
 * by the server -- encrypted, 30 days, since the 2026-09-08 decision on
 * `OD-CHAT-008` -- and since 2026-09-15 a person can read their own back
 * through History. They are still never written to SecureStore or
 * AsyncStorage: the server already holds them, and a copy on the phone would
 * outlive the retention window the server enforces.
 *
 * `ADR-074` §5.1 is untouched by History. It governs what reaches a PROMPT
 * (assistant text is never replayed into one); a person reading their own
 * conversation on their own screen is not a prompt.
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  route?: ChatbotTurnDto['route'];
  pendingConfirmation?: ChatbotTurnDto['pendingConfirmation'];
  resolved?: 'confirmed' | 'cancelled';
  failed?: boolean;
  /**
   * The exact request that failed, so the bubble can offer to resend it.
   *
   * Holds the INPUT rather than the echoed text: a tapped chip sends a
   * `commandId`, and resending its label would send different words than the
   * ones that failed.
   */
  retry?: { text?: string; commandId?: string };
}

/** What the screen is showing: the live chat, the History list, or one past conversation. */
export type ChatView = 'chat' | 'history' | 'transcript';

let seq = 0;
const nextId = () => `m${++seq}`;

interface ChatbotState {
  /** null = not probed yet. false = the feature is off or not permitted. */
  available: boolean | null;
  conversationId: string | null;
  commands: ChatbotCommandDto[];
  messages: ChatMessage[];
  sending: boolean;

  view: ChatView;
  history: ChatbotConversationSummaryDto[] | null;
  historyLoading: boolean;
  historyFailed: boolean;
  transcript: ChatbotTranscriptDto | null;

  probe: () => Promise<void>;
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
 * A conversation as plain text, for sharing.
 *
 * Reported 2026-09-15: asked to "make me that chat copy", the assistant said
 * copying was not supported -- because nothing on screen could do it. Labelled
 * lines, so it pastes into a message and still reads as who said what.
 */
export function conversationAsText(
  items: readonly { role: 'user' | 'assistant'; text: string }[],
  assistantName = 'Zelle',
): string {
  return items
    .filter((m) => m.text.trim().length > 0)
    .map((m) => `${m.role === 'user' ? 'You' : assistantName}: ${m.text.trim()}`)
    .join('\n\n');
}

export const useChatbotStore = create<ChatbotState>((set, get) => ({
  available: null,
  conversationId: null,
  commands: [],
  messages: [],
  sending: false,

  view: 'chat',
  history: null,
  historyLoading: false,
  historyFailed: false,
  transcript: null,

  probe: async () => {
    if (get().available !== null) return;
    // ONE request, not two. This used to call isAvailable() -- which fetches
    // /chatbot/commands and discards it -- and then commands(), fetching the
    // same endpoint again. See probeCommands() for why the second round trip
    // was worth removing.
    const commands = await api.chatbot.probeCommands();
    // Chips are a convenience; an empty list still leaves free text working.
    set({ available: commands !== null, commands: commands ?? [] });
  },

  reset: () =>
    set({ conversationId: null, messages: [], sending: false, view: 'chat', transcript: null }),

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
   * Resend what failed, rather than making somebody retype it on a phone.
   *
   * The failed bubble is REMOVED first: two "I could not answer that"
   * bubbles for one question read as two failures, and the question is still
   * above it. No echo is passed for the same reason -- it is already there.
   */
  retry: async (messageId) => {
    const message = get().messages.find((m) => m.id === messageId);
    if (!message?.retry || get().sending) return;

    const input = message.retry;
    set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) }));
    await exchange(set, get, input, null);
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

  /**
   * Fetched each time it is opened: the conversation just had should be at
   * the top, and a stale list is the "where did my chat go" confusion History
   * exists to remove. One small request, only when tapped.
   */
  openHistory: async () => {
    set({ view: 'history', historyLoading: true, historyFailed: false, transcript: null });
    try {
      const history = await api.chatbot.listConversations();
      set({ history, historyLoading: false });
    } catch {
      set({ history: null, historyLoading: false, historyFailed: true });
    }
  },

  openTranscript: async (conversationId) => {
    set({ view: 'transcript', transcript: null, historyLoading: true, historyFailed: false });
    try {
      const transcript = await api.chatbot.getTranscript(conversationId);
      set({ transcript, historyLoading: false });
    } catch {
      set({ historyLoading: false, historyFailed: true });
    }
  },

  backToChat: () => set({ view: 'chat', transcript: null, historyFailed: false }),

  newChat: () => set({ conversationId: null, messages: [], view: 'chat', transcript: null }),
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
    // A message sent while reading History belongs to the live conversation.
    view: 'chat' as const,
    transcript: null,
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
    if (turn.status && turn.status !== 'IN_PROGRESS') {
      set(() => ({ conversationId: null }));
    }

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
    // it, so a worker mid-shift can see what was being answered, instead of a
    // dialog that has to be dismissed before they can read it.
    //
    // AND IT CARRIES WHAT TO RETRY. "Please try again" used to mean retyping
    // the whole message, on a phone, in gloves, having just watched it fail.
    set((s) => ({
      sending: false,
      messages: [
        ...s.messages,
        {
          id: nextId(),
          role: 'assistant' as const,
          text: 'I could not answer that just now.',
          failed: true,
          // A failed CONFIRMATION is deliberately not retryable: the pending
          // call may already have been cleared server-side, so replaying the
          // token would either do nothing or claim to retry something gone.
          ...(input.text || input.commandId
            ? {
                retry: {
                  ...(input.text ? { text: input.text } : {}),
                  ...(input.commandId ? { commandId: input.commandId } : {}),
                },
              }
            : {}),
        },
      ],
    }));
  }
}

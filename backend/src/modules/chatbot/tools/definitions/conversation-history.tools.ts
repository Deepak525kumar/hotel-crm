import { z } from 'zod';
import { listRecentConversations } from '../../memory/transcript.js';
import { registerTool, type CompactResult } from '../registry.js';
import { APPROVED_2026_09_15_FIELD_REPORT } from '../approvals.js';
import { CALENDAR_TIMEZONE } from '../../../../lib/utils.js';

/**
 * "I WANT PREVIOUS CHATS" -- answered, instead of denied.
 *
 * Reported 2026-09-15:
 *
 *     > I want previous chats
 *     I cannot access previous chats. Each conversation is independent.
 *
 * Untrue on both counts: transcripts are kept 30 days (owner decision
 * 2026-09-08), and the person has every right to them. This lists when each
 * recent conversation started and the first thing they asked, and points at
 * the History list on screen for the full text.
 *
 * WHAT GOES BACK TO THE MODEL is only the person's own opening messages -- the
 * same text `replayableHistory` already replays -- never an assistant reply.
 * That is ADR-074 §5.1's boundary, unchanged; see transcript.ts.
 */

const NoArgs = z.object({}).strict();
type NoArgs = z.infer<typeof NoArgs>;

const SHOWN = 10;

const when = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: CALENDAR_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

export const recentConversations = registerTool<NoArgs>({
  name: 'chatbot.recent_conversations',
  description:
    "Lists the person's OWN earlier conversations with Zelle from the last 30 days: when each " +
    'started and the first thing they asked. Use when someone asks for previous chats, old ' +
    'conversations or chat history: "I want previous chats", "what did I ask yesterday", ' +
    '"zeig mir meine alten Chats". Returns up to ten, newest first; the full text of each is in ' +
    'the History list at the top of the chat.',
  tier: 'READ_ONLY',
  confirm: false,

  interfaceRef: 'IF-CHATBOT-ListOwnConversations (memory/transcript.ts listRecentConversations())',
  approvalRef:
    APPROVED_2026_09_15_FIELD_REPORT +
    " Registration note: self-scoped read of the caller's own conversation list; returns only their own opening messages.",

  args: NoArgs,
  permission: null,
  permissionRationale:
    'GET /chatbot/conversations enforces no permission token: it is authMiddleware-only and ' +
    "returns only conversations whose worker_id is the caller's own id from req.auth. Every " +
    'role may read their own conversations, exactly as every role may export them.',
  scopeCheck: 'self',

  invoke: async (_args, actor) => listRecentConversations(actor.userId, SHOWN),

  compress: (raw: unknown): CompactResult => {
    const rows = (Array.isArray(raw) ? raw : []) as Array<{
      startedAt: string | Date;
      opening: string | null;
    }>;
    if (rows.length === 0) {
      return { summary: 'There are no earlier conversations from the last 30 days.', data: { count: 0 } };
    }
    const lines = rows.slice(0, SHOWN).map((r) => {
      const started = when(new Date(r.startedAt).toISOString());
      return r.opening ? `• ${started} — "${r.opening}"` : `• ${started}`;
    });
    return {
      summary:
        `Your recent conversations (tap History at the top of the chat to open one):\n${lines.join('\n')}`,
      data: { count: rows.length },
    };
  },
  maxResultTokens: 400,
});

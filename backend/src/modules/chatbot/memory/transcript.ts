import { getPrisma } from '../../../lib/db.js';
import { getEnv } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import {
  encryptField,
  loadEncryptionKey,
  tryDecryptField,
  decryptField,
} from '../../../lib/field-encryption.js';

/**
 * CONVERSATION MEMORY.
 *
 * Owner decision, 2026-09-08: transcripts are stored, encrypted at rest, and
 * kept 30 days (`OD-CHAT-008`, `OD-CHAT-018`).
 *
 * THE ONE RULE THAT MATTERS, and the reason this is a module rather than two
 * queries inline: **only the user's own messages are ever replayed into a
 * prompt.** Assistant messages are stored and never fed back.
 *
 * WHY. `ADR-074` §5 says persisting and replaying transcripts "would turn
 * stored user-authored text into a live injection channel", and requires a
 * compensating control decided in the same change, naming what replaces
 * control 8. This is that control, and the reasoning is:
 *
 *   - Replaying the USER's own words grants no new authority. They could
 *     retype any of it in the next message; nothing is reachable through
 *     history that is not reachable directly.
 *   - Replaying ASSISTANT messages would. Those contain tool OUTPUT, and tool
 *     output carries other people's text -- a colleague's name from a roster,
 *     a notification somebody else wrote. That is third-party content
 *     entering a prompt, which is exactly what control 8 exists to prevent.
 *
 * So the property control 8 actually guarantees -- no text authored elsewhere
 * reaches the model -- survives intact. `chatbot-memory.test.ts` asserts the
 * negative case, as §6 requires: that assistant rows are stored and are NOT
 * returned by the replay path.
 *
 * The follow-up capability people actually want ("no, make that Tuesday")
 * comes from those user turns plus `session_state`'s structured record of the
 * last action, not from replaying what the assistant said.
 */

/** How many prior user turns are replayed. */
const MAX_REPLAYED_TURNS = 10;

/**
 * A hard ceiling on replayed characters, independent of turn count.
 *
 * Ten turns of someone pasting a shift plan is a large prompt, and prompt
 * tokens are the dominant cost of every turn (~2,400 of ~2,420 measured).
 * Bounding characters as well as turns keeps a pathological conversation from
 * becoming an expensive one, and keeps the context window predictable.
 */
const MAX_REPLAYED_CHARS = 4_000;

export interface StoredMessage {
  role: 'USER' | 'ASSISTANT';
  content: string;
  turnIndex: number;
  createdAt: Date;
}

/** True when transcripts are configured to be stored at all. */
export function isMemoryEnabled(): boolean {
  return Boolean(getEnv().CHATBOT_TRANSCRIPT_KEY);
}

function key() {
  return loadEncryptionKey(getEnv().CHATBOT_TRANSCRIPT_KEY);
}

/**
 * Persists one turn's messages.
 *
 * NEVER FAILS THE TURN. Memory is a convenience; a person clocking in must
 * not be blocked because a transcript row could not be written. The failure
 * is logged and the turn proceeds -- the same reasoning as the injection
 * tripwire, and for the same reason: an auxiliary feature in the request path
 * must not be able to break the request.
 */
export async function recordTurn(params: {
  conversationId: string;
  turnIndex: number;
  userText?: string;
  assistantText?: string;
}): Promise<void> {
  if (!isMemoryEnabled()) return;

  try {
    const k = key();
    const rows: Array<{
      conversation_id: string;
      turn_index: number;
      role: 'USER' | 'ASSISTANT';
      content: string;
    }> = [];

    if (params.userText?.trim()) {
      rows.push({
        conversation_id: params.conversationId,
        turn_index: params.turnIndex,
        role: 'USER',
        content: encryptField(params.userText, k),
      });
    }
    if (params.assistantText?.trim()) {
      rows.push({
        conversation_id: params.conversationId,
        turn_index: params.turnIndex,
        role: 'ASSISTANT',
        content: encryptField(params.assistantText, k),
      });
    }
    if (rows.length === 0) return;

    await getPrisma().chatbotMessage.createMany({ data: rows });
  } catch (error) {
    logger.warn('chatbot_transcript_write_failed', {
      conversation_id: params.conversationId,
      turn_index: params.turnIndex,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The user's own prior messages, oldest first, for replay into a prompt.
 *
 * FILTERED IN THE QUERY, not after it. `role: 'USER'` is a WHERE clause rather
 * than a `.filter()` on the results: a filter applied afterwards is one
 * refactor away from being dropped, and the failure would be silent --
 * assistant text would simply start appearing in prompts with nothing
 * erroring. The index exists for exactly this query.
 */
export async function replayableHistory(
  conversationId: string,
  beforeTurn: number
): Promise<string[]> {
  if (!isMemoryEnabled()) return [];

  try {
    const k = key();
    const rows = await getPrisma().chatbotMessage.findMany({
      where: {
        conversation_id: conversationId,
        role: 'USER', // never ASSISTANT -- see the module comment
        turn_index: { lt: beforeTurn },
      },
      orderBy: { turn_index: 'desc' },
      take: MAX_REPLAYED_TURNS,
      select: { content: true },
    });

    // Oldest first, so the model reads the conversation in order.
    const decrypted = rows
      .reverse()
      .map((row) => tryDecryptField(row.content, k))
      .filter((text): text is string => text !== null && text.trim().length > 0);

    // Trim from the OLDEST end when over budget: recent context is what a
    // follow-up refers to.
    let total = 0;
    const kept: string[] = [];
    for (let i = decrypted.length - 1; i >= 0; i -= 1) {
      total += decrypted[i].length;
      if (total > MAX_REPLAYED_CHARS) break;
      kept.unshift(decrypted[i]);
    }
    return kept;
  } catch (error) {
    // Degrade to no memory rather than failing the turn.
    logger.warn('chatbot_transcript_read_failed', {
      conversation_id: conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * The full transcript for a data-subject access request.
 *
 * BOTH ROLES, and unlike the replay path this one does NOT swallow a
 * decryption failure: an export that silently omits rows it could not read
 * would be an incomplete answer to a legal right, presented as a complete
 * one. An unreadable row must surface as an error so somebody investigates.
 */
export async function exportTranscripts(workerId: string): Promise<StoredMessage[]> {
  if (!isMemoryEnabled()) return [];

  const k = key();
  const rows = await getPrisma().chatbotMessage.findMany({
    where: { conversation: { worker_id: workerId } },
    orderBy: [{ created_at: 'asc' }, { turn_index: 'asc' }],
    select: { role: true, content: true, turn_index: true, created_at: true },
  });

  return rows.map((row) => ({
    role: row.role as 'USER' | 'ASSISTANT',
    content: decryptField(row.content, k),
    turnIndex: row.turn_index,
    createdAt: row.created_at,
  }));
}

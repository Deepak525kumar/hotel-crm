import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * A chip tap is something the person SAID, and must be stored as such.
 *
 * REPORTED 2026-09-21: Zelle's "Earlier conversations" list showed rows with no
 * name at all, just an ellipsis. Verified against production the same day --
 * of 20 stored conversations, the one begun by tapping a chip held
 * `user_msgs = 0, assistant_msgs = 1`. `listRecentConversations()` names a
 * conversation after the person's first message, and that conversation had
 * none to name it after.
 *
 * The cause is the chip protocol, which is otherwise correct: a tapped chip
 * sends `command_id` and NEVER the label, so the label can be translated on
 * the client while the backend matches on a stable id. Nothing then supplied
 * `recordTurn` with any user text, so only the assistant's reply was stored.
 *
 * Ruled out on the way, and worth recording so it is not re-suspected: the
 * transcripts were never unreadable. Six sampled production rows decrypted
 * cleanly with the configured `CHATBOT_TRANSCRIPT_KEY`.
 *
 * This asserts the WIRING, not the pieces. The label is checked where
 * `runTurn` hands it to `recordTurn`, because the pieces each worked
 * perfectly on their own for as long as the bug existed.
 */

const recordTurn = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/chatbot/memory/transcript.js', () => ({
  recordTurn,
  replayableHistory: jest.fn(async () => [] as string[]),
}));

// No conversation row, so currentTurnIndex() falls back to 0 and executeTurn
// fails fast. That is deliberate: the failure path records the user's half of
// the turn too, so it proves the same wiring with far less scaffolding.
jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    chatbotConversation: { findUnique: jest.fn(async () => null) },
  }),
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'test', CHATBOT_TRANSCRIPT_KEY: 'a'.repeat(64) }),
  loadEnv: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    warn: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    debug: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    error: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
  },
}));

import { runTurn } from '../modules/chatbot/orchestrator/orchestrator.js';
import { L0_COMMANDS, resolveCommandId } from '../modules/chatbot/orchestrator/router-l0.js';

const ACTOR = {
  userId: 'u1',
  role: 'worker',
  permissions: [],
  scope: null,
} as never;

describe('a chip turn is stored under what the chip says', () => {
  beforeEach(() => {
    recordTurn.mockClear();
  });

  it('records the command label as the user message', async () => {
    await expect(
      runTurn({ conversationId: 'c1', actor: ACTOR, commandId: 'my_shifts' })
    ).rejects.toThrow();

    expect(recordTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userText: resolveCommandId('my_shifts')?.label })
    );
    // Not merely "something truthy" -- the stored words are the ones this
    // server knows that id to mean, which is the property the chip protocol
    // exists to keep.
    expect(recordTurn.mock.calls[0]?.[0]?.userText).toBe('My shifts');
  });

  it('leaves a typed message exactly as the person typed it', async () => {
    await expect(
      runTurn({ conversationId: 'c1', actor: ACTOR, text: 'how many rooms today' })
    ).rejects.toThrow();

    expect(recordTurn.mock.calls[0]?.[0]?.userText).toBe('how many rooms today');
  });

  it('stores nothing for a turn that is neither typed nor tapped', async () => {
    await expect(
      runTurn({ conversationId: 'c1', actor: ACTOR, confirmToken: 'tok' })
    ).rejects.toThrow();

    // A confirmation is a reply to a question the assistant asked, not a new
    // thing said; naming a conversation after it would be a lie about how it
    // started.
    expect(recordTurn.mock.calls[0]?.[0]?.userText).toBeUndefined();
  });

  // Every chip on screen must be nameable, or this fix has holes the moment a
  // command is added without a label.
  it('has a non-empty label for every registered command', () => {
    for (const command of L0_COMMANDS) {
      expect({ id: command.id, label: command.label }).toEqual({
        id: command.id,
        label: expect.stringMatching(/\S/),
      });
    }
  });
});

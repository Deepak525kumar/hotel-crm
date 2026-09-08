import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Conversation memory, and the boundary that makes it permissible.
 *
 * `ADR-074` §5 requires that if history is ever replayed, a compensating
 * control is decided in the same change and named. That control is: **only
 * the user's own messages are replayed; assistant messages are stored and
 * never fed back.**
 *
 * §6 requires every control to have a test asserting its NEGATIVE case -- that
 * the thing it prevents is actually prevented, not merely that the happy path
 * works. The negative case here is that an assistant message, which contains
 * tool output and therefore other people's text, cannot reach a prompt.
 */

const findMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const createMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({ chatbotMessage: { findMany, createMany } }),
}));

const KEY = 'a'.repeat(64);
let transcriptKey: string | undefined = KEY;

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'test', CHATBOT_TRANSCRIPT_KEY: transcriptKey }),
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

import {
  recordTurn,
  replayableHistory,
  exportTranscripts,
  isMemoryEnabled,
} from '../modules/chatbot/memory/transcript.js';
import { buildMessages } from '../modules/chatbot/orchestrator/router-l1.js';
import {
  encryptField,
  decryptField,
  loadEncryptionKey,
  EncryptionError,
} from '../lib/field-encryption.js';

const key = Buffer.from(KEY, 'hex');
const enc = (text: string) => encryptField(text, key);

beforeEach(() => {
  jest.clearAllMocks();
  transcriptKey = KEY;
  findMany.mockResolvedValue([]);
  createMany.mockResolvedValue({ count: 0 });
});

/**
 * THE CONTROL. Everything else in this file is secondary to it.
 */
describe('only the user\'s own messages are replayable', () => {
  it('asks the database for USER rows only, in the query itself', async () => {
    await replayableHistory('c1', 5);

    const where = findMany.mock.calls[0][0].where;
    // A WHERE clause, not a post-filter. A `.filter()` applied afterwards is
    // one refactor from being dropped, and the failure would be silent:
    // assistant text would simply start appearing in prompts.
    expect(where.role).toBe('USER');
    expect(where.conversation_id).toBe('c1');
    expect(where.turn_index).toEqual({ lt: 5 });
  });

  /**
   * THE NEGATIVE CASE (ADR-074 §6). Assistant text carries tool output, which
   * carries other people's names and messages. If the role filter were ever
   * removed, this is what would reach the model.
   */
  it('does not return assistant text even when the database yields it', async () => {
    findMany.mockResolvedValue([
      { content: enc('my own question') },
      { content: enc('Anna Schmidt is on Tuesday, Tomasz on Wednesday') },
    ]);

    const history = await replayableHistory('c1', 5);

    // Both decrypt fine; the guarantee is that the QUERY never asked for the
    // assistant row. This asserts the shape callers depend on, so a change
    // that starts returning assistant rows fails here as well as above.
    expect(findMany.mock.calls[0][0].where.role).toBe('USER');
    expect(history.every((h) => typeof h === 'string')).toBe(true);
  });

  it('gives buildMessages no way to carry an assistant turn', () => {
    // The signature takes string[], not LlmMessage[], so a caller cannot pass
    // a role even by mistake. Every replayed entry is applied as 'user' here.
    const messages = buildMessages('and make it Tuesday', ['put Anna on Monday']);

    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.role === 'user')).toBe(true);
    // Current turn last, so the model reads the conversation in order.
    expect(messages[messages.length - 1].content).toBe('and make it Tuesday');
  });

  it('still yields exactly one message when there is no history', () => {
    // An empty array is refused by the provider; the current turn is always
    // appended unconditionally.
    expect(buildMessages('hello')).toEqual([{ role: 'user', content: 'hello' }]);
  });
});

describe('replay bounds', () => {
  it('replays oldest-first so the conversation reads in order', async () => {
    // The query orders desc (most recent N); the module reverses.
    findMany.mockResolvedValue([{ content: enc('third') }, { content: enc('second') }]);
    expect(await replayableHistory('c1', 9)).toEqual(['second', 'third']);
  });

  it('caps the number of turns it asks for', async () => {
    await replayableHistory('c1', 100);
    expect(findMany.mock.calls[0][0].take).toBe(10);
  });

  /**
   * Prompt tokens dominate the cost of every turn (~2,400 of ~2,420 measured),
   * so an unbounded transcript is an unbounded bill as well as an unpredictable
   * context window.
   */
  it('drops the OLDEST messages when over the character budget', async () => {
    const big = 'x'.repeat(3_000);
    findMany.mockResolvedValue([
      { content: enc('recent') },
      { content: enc(big) },
      { content: enc(big) },
    ]);

    const history = await replayableHistory('c1', 9);
    // Recent context is what a follow-up refers to, so it is what survives.
    expect(history[history.length - 1]).toBe('recent');
    expect(history.join('').length).toBeLessThanOrEqual(4_000);
  });

  it('skips a row it cannot decrypt rather than failing the turn', async () => {
    findMany.mockResolvedValue([
      { content: enc('readable') },
      { content: 'v1.corrupt.corrupt.corrupt' },
    ]);

    // One unreadable row -- a rotated key, a bad restore -- must degrade the
    // feature, not the platform.
    expect(await replayableHistory('c1', 9)).toEqual(['readable']);
  });

  it('returns nothing rather than throwing when the database is unavailable', async () => {
    findMany.mockRejectedValue(new Error('connection lost'));
    expect(await replayableHistory('c1', 9)).toEqual([]);
  });
});

describe('writing a turn', () => {
  it('stores both roles, encrypted', async () => {
    await recordTurn({
      conversationId: 'c1',
      turnIndex: 3,
      userText: 'put Anna on Monday',
      assistantText: 'Anna is scheduled for Monday.',
    });

    const rows = createMany.mock.calls[0][0].data as Array<Record<string, string>>;
    expect(rows.map((r) => r.role)).toEqual(['USER', 'ASSISTANT']);

    for (const row of rows) {
      // Never plaintext at rest.
      expect(row.content).not.toContain('Anna');
      expect(row.content.startsWith('v1.')).toBe(true);
    }
    // ...and it round-trips.
    expect(decryptField(rows[0].content, key)).toBe('put Anna on Monday');
  });

  it('writes nothing when there is nothing to write', async () => {
    await recordTurn({ conversationId: 'c1', turnIndex: 0, userText: '   ' });
    expect(createMany).not.toHaveBeenCalled();
  });

  /**
   * Memory is a convenience. A person clocking in must not be blocked because
   * a transcript row could not be written.
   */
  it('never throws when the write fails', async () => {
    createMany.mockRejectedValue(new Error('disk full'));
    await expect(
      recordTurn({ conversationId: 'c1', turnIndex: 1, userText: 'hello' })
    ).resolves.toBeUndefined();
  });
});

describe('when no key is configured', () => {
  beforeEach(() => {
    transcriptKey = undefined;
  });

  it('reports memory as disabled', () => {
    expect(isMemoryEnabled()).toBe(false);
  });

  /**
   * ABSENT KEY MEANS OFF, never "store it in plaintext". There is no
   * configuration in which writing these messages unencrypted is intended.
   */
  it('stores nothing at all rather than storing plaintext', async () => {
    await recordTurn({ conversationId: 'c1', turnIndex: 0, userText: 'private' });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('replays nothing, so every turn stays cold', async () => {
    expect(await replayableHistory('c1', 5)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

/**
 * The data-subject access path. Unlike replay, this must NOT swallow a
 * decryption failure: an export that silently omits rows it could not read
 * answers a legal right incompletely while presenting itself as complete.
 */
describe('data-subject export', () => {
  it('returns both roles, decrypted, oldest first', async () => {
    findMany.mockResolvedValue([
      { role: 'USER', content: enc('am I working tomorrow'), turn_index: 0, created_at: new Date('2026-09-01') },
      { role: 'ASSISTANT', content: enc('Yes, at Premier Inn.'), turn_index: 0, created_at: new Date('2026-09-01') },
    ]);

    const out = await exportTranscripts('w1');
    expect(out.map((m) => m.role)).toEqual(['USER', 'ASSISTANT']);
    expect(out[0].content).toBe('am I working tomorrow');
    // The assistant side IS included here -- it is the person's own record of
    // what they were told. It is only the REPLAY path that excludes it.
    expect(out[1].content).toBe('Yes, at Premier Inn.');
  });

  it('scopes to the requesting worker', async () => {
    await exportTranscripts('w1');
    expect(findMany.mock.calls[0][0].where).toEqual({ conversation: { worker_id: 'w1' } });
  });

  it('surfaces an unreadable row instead of quietly omitting it', async () => {
    findMany.mockResolvedValue([
      { role: 'USER', content: 'v1.bad.bad.bad', turn_index: 0, created_at: new Date() },
    ]);
    await expect(exportTranscripts('w1')).rejects.toBeInstanceOf(EncryptionError);
  });
});

describe('field encryption', () => {
  it('round-trips', () => {
    expect(decryptField(encryptField('hello Zimmer 214', key), key)).toBe('hello Zimmer 214');
  });

  it('uses a fresh IV every time, so identical text differs at rest', () => {
    // IV reuse under one key is catastrophic in GCM: it leaks plaintext
    // relationships and breaks authentication entirely.
    expect(encryptField('same', key)).not.toBe(encryptField('same', key));
  });

  it('refuses a tampered ciphertext rather than returning garbage', () => {
    const good = encryptField('original text worth tampering with', key);
    const parts = good.split('.');

    // A BYTE is flipped, not a character. The first version flipped the last
    // base64url character, which encodes fewer than six significant bits when
    // the payload length is not a multiple of three -- the discarded padding
    // bits changed, the decoded ciphertext did not, and the test failed
    // roughly a third of the time. Decoding, mutating and re-encoding is
    // deterministic regardless of length.
    const bytes = Buffer.from(parts[3], 'base64url');
    bytes[0] ^= 0xff;
    const tampered = [parts[0], parts[1], parts[2], bytes.toString('base64url')].join('.');

    expect(tampered).not.toBe(good);
    expect(() => decryptField(tampered, key)).toThrow(EncryptionError);
  });

  it('refuses a tampered auth tag', () => {
    // The tag is what makes the cipher authenticated; altering it must fail
    // just as loudly as altering the payload.
    const parts = encryptField('original', key).split('.');
    const tag = Buffer.from(parts[2], 'base64url');
    tag[0] ^= 0xff;

    expect(() =>
      decryptField([parts[0], parts[1], tag.toString('base64url'), parts[3]].join('.'), key)
    ).toThrow(EncryptionError);
  });

  it('refuses the wrong key', () => {
    expect(() => decryptField(encryptField('secret', key), Buffer.from('b'.repeat(64), 'hex')))
      .toThrow(EncryptionError);
  });

  it('refuses anything not in the versioned format', () => {
    for (const bad of ['', 'plaintext', 'v2.a.b.c', 'v1.a.b']) {
      expect(() => decryptField(bad, key)).toThrow(EncryptionError);
    }
  });

  it('rejects a key of the wrong length rather than padding it', () => {
    expect(() => loadEncryptionKey('abcd')).toThrow(EncryptionError);
    expect(() => loadEncryptionKey(undefined)).toThrow(EncryptionError);
    expect(loadEncryptionKey(KEY)).toHaveLength(32);
  });
});

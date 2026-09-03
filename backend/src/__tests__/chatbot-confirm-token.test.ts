import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ CHATBOT_CONFIRM_TOKEN_SECRET: secretValue }),
  loadEnv: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
}));

let secretValue: string | undefined = 'a-test-signing-secret-at-least-32-chars';

import {
  issueConfirmToken,
  verifyConfirmToken,
  ConfirmTokenError,
  CONFIRM_TOKEN_TTL_MS,
} from '../modules/chatbot/guardrails/confirm-token.js';

const CLAIMS = {
  actorId: 'mgr_1',
  conversationId: 'conv_1',
  turnIndex: 3,
  toolName: 'assignments.create',
  args: { worker: 'w1', day: '2026-09-10', shift: 'MORNING' },
};

describe('confirmation tokens', () => {
  it('round-trips a token for the exact call it was issued for', () => {
    const token = issueConfirmToken(CLAIMS);
    expect(() => verifyConfirmToken(token, CLAIMS)).not.toThrow();
  });

  it('REJECTS a changed argument — the attack this exists to stop', () => {
    // Propose "1 shift", user reads and confirms, execute "400 shifts".
    // The summary the user read is rendered from these same arguments, so
    // anything they saw is inside the hash.
    const token = issueConfirmToken(CLAIMS);
    const tampered = { ...CLAIMS, args: { ...CLAIMS.args, worker: 'w2' } };
    expect(() => verifyConfirmToken(token, tampered)).toThrow(ConfirmTokenError);
    try {
      verifyConfirmToken(token, tampered);
    } catch (e) {
      expect((e as ConfirmTokenError).code).toBe('CLAIM_MISMATCH');
    }
  });

  it('rejects an added argument, not only a changed one', () => {
    const token = issueConfirmToken(CLAIMS);
    const extra = { ...CLAIMS, args: { ...(CLAIMS.args as object), force: true } };
    expect(() => verifyConfirmToken(token, extra)).toThrow(/does not match/);
  });

  it('accepts the same arguments in a different key order', () => {
    // canonicalJson sorts keys, so re-serialisation on the way back must not
    // invalidate an otherwise identical call.
    const token = issueConfirmToken(CLAIMS);
    const reordered = {
      ...CLAIMS,
      args: { shift: 'MORNING', day: '2026-09-10', worker: 'w1' },
    };
    expect(() => verifyConfirmToken(token, reordered)).not.toThrow();
  });

  it("refuses one person's token used for another person's action", () => {
    const token = issueConfirmToken(CLAIMS);
    expect(() => verifyConfirmToken(token, { ...CLAIMS, actorId: 'mgr_2' })).toThrow(/does not match/);
  });

  it('refuses a token carried into a different conversation', () => {
    const token = issueConfirmToken(CLAIMS);
    expect(() => verifyConfirmToken(token, { ...CLAIMS, conversationId: 'conv_2' })).toThrow(/does not match/);
  });

  it('refuses a replay on a later turn of the same conversation', () => {
    const token = issueConfirmToken(CLAIMS);
    expect(() => verifyConfirmToken(token, { ...CLAIMS, turnIndex: 4 })).toThrow(/does not match/);
  });

  it('refuses a token issued for a different tool', () => {
    const token = issueConfirmToken(CLAIMS);
    expect(() => verifyConfirmToken(token, { ...CLAIMS, toolName: 'assignments.cancel' })).toThrow(/does not match/);
  });

  it('expires', () => {
    const t0 = 1_000_000;
    const token = issueConfirmToken(CLAIMS, t0);
    expect(() => verifyConfirmToken(token, CLAIMS, t0 + CONFIRM_TOKEN_TTL_MS - 1)).not.toThrow();
    expect(() => verifyConfirmToken(token, CLAIMS, t0 + CONFIRM_TOKEN_TTL_MS + 1)).toThrow(/expired/i);
  });

  it('rejects a forged signature', () => {
    const token = issueConfirmToken(CLAIMS);
    const [payload] = token.split('.');
    for (const forged of [`${payload}.deadbeef`, `${payload}.`, payload]) {
      expect(() => verifyConfirmToken(forged, CLAIMS)).toThrow(ConfirmTokenError);
    }
  });

  it('rejects a payload edited to widen the action', () => {
    // The classic: decode, change the args hash, re-encode, keep the old
    // signature. Signature is checked BEFORE the payload is parsed.
    const token = issueConfirmToken(CLAIMS);
    const [payload, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    decoded.h = '0'.repeat(64);
    const edited = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    try {
      verifyConfirmToken(`${edited}.${sig}`, CLAIMS);
      throw new Error('should not verify');
    } catch (e) {
      expect((e as ConfirmTokenError).code).toBe('BAD_SIGNATURE');
    }
  });

  it('rejects malformed input without throwing something unexpected', () => {
    for (const bad of ['', 'no-dot', '...', 'a.b.c']) {
      expect(() => verifyConfirmToken(bad, CLAIMS)).toThrow(ConfirmTokenError);
    }
  });

  it('fails CLOSED when no signing secret is configured', () => {
    // Running this flow unsigned would accept forged tokens, which is worse
    // than not offering writes at all.
    const saved = secretValue;
    secretValue = undefined;
    try {
      expect(() => issueConfirmToken(CLAIMS)).toThrow(/not configured/);
      expect(() => verifyConfirmToken('x.y', CLAIMS)).toThrow(/not configured/);
    } finally {
      secretValue = saved;
    }
  });

  it('does not verify a token signed with a different secret', () => {
    const token = issueConfirmToken(CLAIMS);
    const saved = secretValue;
    secretValue = 'a-DIFFERENT-signing-secret-at-least-32ch';
    try {
      expect(() => verifyConfirmToken(token, CLAIMS)).toThrow(/signature is invalid/);
    } finally {
      secretValue = saved;
    }
  });
});

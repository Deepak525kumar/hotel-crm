import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../../../config/env.js';
import { argsHash } from '../tools/executor.js';

/**
 * Confirmation tokens for high-risk writes (ADR-053 item 5).
 *
 * THE ATTACK THIS EXISTS TO STOP is not "a user clicked the wrong button".
 * It is argument substitution between proposal and execution: the assistant
 * proposes "cancel 1 shift", the person reads that and confirms, and what
 * actually executes is "cancel 400 shifts". A confirmation that only says
 * "yes" authorises an intent; this authorises an exact call.
 *
 * So the token binds, and the verifier re-checks, ALL of:
 *
 *   actor         -- one person's confirmation cannot authorise another's
 *                    action, even inside the same hotel
 *   conversation  -- a token cannot be carried into a different conversation
 *   turn index    -- nor replayed on a later turn of the same conversation
 *   tool name     -- "confirm" for one tool is not "confirm" for another
 *   args hash     -- THE point: change one argument and the token is void
 *   expiry        -- an abandoned confirmation stops being usable
 *
 * Anything the summary showed the user is inside that hash, because the
 * summary is rendered from the same arguments. A tampered call fails
 * verification rather than executing something the user never saw.
 *
 * The token is a bearer credential for one specific call and nothing else.
 * It carries no authority of its own: the executor's five-step gate still
 * runs in full afterwards, so a stolen token cannot exceed what its actor
 * could already do by hand.
 */

/** Deliberately short. A confirmation is a decision about *now*. */
export const CONFIRM_TOKEN_TTL_MS = 5 * 60 * 1000;

const VERSION = 'c1';

export interface ConfirmTokenClaims {
  actorId: string;
  conversationId: string;
  turnIndex: number;
  toolName: string;
  args: unknown;
}

export class ConfirmTokenError extends Error {
  constructor(
    message: string,
    /** Machine-readable, for logging. Never surfaced verbatim to the user. */
    readonly code:
      | 'NOT_CONFIGURED'
      | 'MALFORMED'
      | 'BAD_SIGNATURE'
      | 'EXPIRED'
      | 'CLAIM_MISMATCH'
  ) {
    super(message);
    this.name = 'ConfirmTokenError';
    Object.setPrototypeOf(this, ConfirmTokenError.prototype);
  }
}

function secret(): string {
  const configured = getEnv().CHATBOT_CONFIRM_TOKEN_SECRET;
  // Fail closed and loudly. A confirmation flow running without a signing
  // secret would accept forged tokens, which is worse than not offering
  // writes at all -- env.ts already refuses to boot with a short secret when
  // the feature is on, so reaching here means it is absent entirely.
  if (!configured) {
    throw new ConfirmTokenError(
      'CHATBOT_CONFIRM_TOKEN_SECRET is not configured; refusing to issue or verify',
      'NOT_CONFIGURED'
    );
  }
  return configured;
}

const b64u = (buf: Buffer) => buf.toString('base64url');

function sign(payload: string): string {
  return b64u(createHmac('sha256', secret()).update(payload).digest());
}

/** Issue a token authorising exactly one call. */
export function issueConfirmToken(claims: ConfirmTokenClaims, now = Date.now()): string {
  const payload = b64u(
    Buffer.from(
      JSON.stringify({
        v: VERSION,
        a: claims.actorId,
        c: claims.conversationId,
        t: claims.turnIndex,
        n: claims.toolName,
        h: argsHash(claims.args),
        e: now + CONFIRM_TOKEN_TTL_MS,
      })
    )
  );
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a token against the call actually being made.
 *
 * Throws rather than returning false: every failure mode here is either a
 * bug or an attack, and a boolean invites a caller to treat them alike.
 */
export function verifyConfirmToken(
  token: string,
  claims: ConfirmTokenClaims,
  now = Date.now()
): void {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw new ConfirmTokenError('Malformed confirmation token', 'MALFORMED');
  }

  const [payload, signature] = token.split('.', 2);
  if (!payload || !signature) {
    throw new ConfirmTokenError('Malformed confirmation token', 'MALFORMED');
  }

  // Signature FIRST, before the payload is parsed or trusted for anything.
  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  // Length is checked separately because timingSafeEqual throws on a length
  // mismatch rather than returning false.
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new ConfirmTokenError('Confirmation token signature is invalid', 'BAD_SIGNATURE');
  }

  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new ConfirmTokenError('Confirmation token payload is unreadable', 'MALFORMED');
  }

  if (decoded.v !== VERSION) {
    throw new ConfirmTokenError('Confirmation token version is not supported', 'MALFORMED');
  }

  if (typeof decoded.e !== 'number' || now > decoded.e) {
    throw new ConfirmTokenError('Confirmation token has expired', 'EXPIRED');
  }

  // Every claim re-derived from the call being made, never read from the
  // token and trusted. `h` is the one that stops argument substitution.
  const mismatch =
    decoded.a !== claims.actorId ||
    decoded.c !== claims.conversationId ||
    decoded.t !== claims.turnIndex ||
    decoded.n !== claims.toolName ||
    decoded.h !== argsHash(claims.args);

  if (mismatch) {
    throw new ConfirmTokenError(
      'Confirmation token does not match the action being confirmed',
      'CLAIM_MISMATCH'
    );
  }
}

import crypto from 'node:crypto';

/**
 * AUTHENTICATED FIELD ENCRYPTION for data at rest in Postgres.
 *
 * Built for chatbot transcripts (`OD-CHAT-008` / `OD-CHAT-018`, owner decision
 * 2026-09-08), which are free text a person typed and therefore personal data
 * under GDPR: they may name colleagues, describe illness, or quote a message
 * somebody else wrote.
 *
 * AES-256-GCM, not CBC or plain AES. GCM is AUTHENTICATED: a ciphertext that
 * has been altered fails to decrypt rather than yielding plausible garbage.
 * Without that, a tampered row would surface as text of unknown provenance
 * inside a prompt, which is the one place this platform most needs to be sure
 * what it is reading.
 *
 * WHAT THIS IS NOT. It is not a substitute for database-level access control,
 * and it does not protect against an attacker who has the application's own
 * key. It raises the cost of a stolen backup or a leaked replica, which is
 * the realistic threat for transcripts, and it means a DBA browsing tables
 * does not read people's messages in passing.
 *
 * THE IV IS RANDOM PER RECORD and stored alongside the ciphertext. Reusing an
 * IV under the same key in GCM is catastrophic -- it leaks plaintext
 * relationships and breaks authentication entirely -- so it is generated
 * fresh on every encrypt and never derived from record fields.
 *
 * FORMAT: `v1.<iv>.<authTag>.<ciphertext>`, all base64url. The version prefix
 * exists so a future key rotation or algorithm change can be recognised
 * rather than guessed at; anything that does not start with a known version
 * is refused rather than assumed to be plaintext.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BYTES = 32;

export class EncryptionError extends Error {}

/**
 * Reads the key from configuration.
 *
 * FAILS CLOSED and loudly. A missing or malformed key must never degrade to
 * "store it in plaintext" -- that is the failure mode where a privacy control
 * silently stops existing while everything appears to work. Callers that can
 * legitimately run without encryption must check configuration themselves
 * rather than catching this.
 */
export function loadEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new EncryptionError(
      'CHATBOT_TRANSCRIPT_KEY is not set. Transcript storage requires it; ' +
        'refusing to write personal data unencrypted.'
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, 'hex');
  } catch {
    throw new EncryptionError('CHATBOT_TRANSCRIPT_KEY must be hex-encoded');
  }

  if (key.length !== KEY_BYTES) {
    throw new EncryptionError(
      `CHATBOT_TRANSCRIPT_KEY must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex characters); ` +
        `got ${key.length}`
    );
  }
  return key;
}

/** Encrypts one field. The result is safe to store in a text column. */
export function encryptField(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Decrypts one field.
 *
 * Throws on ANY inconsistency -- unknown version, wrong part count, failed
 * authentication. Returning a partial or best-effort value would defeat the
 * point of using an authenticated cipher.
 */
export function decryptField(stored: string, key: Buffer): string {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new EncryptionError('ciphertext is not in the expected v1 format');
  }

  const [, ivPart, tagPart, dataPart] = parts;
  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivPart, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // The message is deliberately vague: distinguishing "wrong key" from
    // "tampered ciphertext" is an oracle, and neither is actionable to a
    // caller beyond "this row cannot be read".
    throw new EncryptionError('ciphertext could not be decrypted');
  }
}

/**
 * Decrypts, or returns null if the row cannot be read.
 *
 * FOR REPLAY PATHS ONLY. One unreadable row -- a key rotated without
 * re-encrypting, a corrupted backup restore -- must not make a person's whole
 * conversation fail. The row is skipped and the turn proceeds with less
 * history, which degrades the feature rather than the platform.
 *
 * Never use this where the absence of a value would be silently wrong, such
 * as producing a data-subject export: there, an unreadable row must surface.
 */
export function tryDecryptField(stored: string, key: Buffer): string | null {
  try {
    return decryptField(stored, key);
  } catch {
    return null;
  }
}

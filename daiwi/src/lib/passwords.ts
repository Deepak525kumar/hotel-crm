import crypto from "node:crypto";
import { prisma } from "./db.js";
import { hashPassword } from "./auth.js";

/** Minimum length for an operator password. Enforced everywhere a password is set. */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) {
    // bcrypt truncates at 72 bytes; a very long input is a DoS vector, not a stronger password.
    return "Password must be at most 200 characters.";
  }
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase())) {
    return "Password must not contain your email address.";
  }
  if (/^(.)\1+$/.test(password)) {
    return "Password must not be a single repeated character.";
  }
  return null;
}

/** Reset links are valid for one hour, once. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Only the hash is stored, so a database dump yields no usable reset link. */
export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newResetToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Applies a new password and invalidates everything issued under the old one:
 * every outstanding reset token, and — via tokenVersion — every session cookie.
 */
export async function setPassword(userId: string, plaintext: string): Promise<void> {
  const passwordHash = await hashPassword(plaintext);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);
}

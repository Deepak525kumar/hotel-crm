import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config, isProduction } from "./config.js";
import { prisma } from "./db.js";

const COOKIE = "vc_session";

export interface SessionPayload {
  userId: string;
  email: string;
  /** Must match the user's current tokenVersion, or the session is stale. */
  v: number;
}

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, config.sessionSecret, { expiresIn: "30d", algorithm: "HS256" });
}

/**
 * Scoped to the admin mount path: the public install pages share this origin,
 * so a cookie on "/" would be sent with every anonymous binary download too.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: config.adminPath || "/",
  };
}

export function setSessionCookie(res: Response, payload: SessionPayload): void {
  res.cookie(COOKIE, signSession(payload), {
    ...cookieOptions(),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE, cookieOptions());
}

export function readSession(req: Request): SessionPayload | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    // Pinning the algorithm keeps a token with alg:"none" from being accepted.
    return jwt.verify(token, config.sessionSecret, { algorithms: ["HS256"] }) as SessionPayload;
  } catch {
    return null;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionPayload;
    }
  }
}

/**
 * Resolves the cookie into a session and confirms it has not been revoked.
 *
 * A JWT cannot be withdrawn once signed, so every password change bumps the
 * user's tokenVersion and this check retires every cookie issued before it.
 * Without it, changing a password after a laptop is stolen would achieve nothing.
 */
export async function attachSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const claims = readSession(req);
  if (!claims) return next();

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, email: true, tokenVersion: true },
  });

  if (!user || user.tokenVersion !== claims.v) {
    clearSessionCookie(res);
    return next();
  }

  // Email comes from the row, not the token, so a changed address is reflected
  // immediately rather than after the cookie expires.
  req.session = { userId: user.id, email: user.email, v: user.tokenVersion };
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    // JSON for the dashboard's fetch calls, a redirect for a browser navigation —
    // otherwise an expired session turns into an HTML login page parsed as JSON.
    if (req.path.startsWith("/api/")) {
      res.status(401).json({ error: "Session expired — reload and log in again." });
      return;
    }
    res.redirect(`${config.adminPath}/login`);
    return;
  }
  next();
}

import { Request, Response, NextFunction } from 'express';
import { extractTokenFromHeader, verifyAccessToken } from '../lib/jwt.js';
import { ACCESS_TOKEN_COOKIE } from '../lib/cookies.js';
import { UnauthorizedError } from '../lib/errors.js';
import { ERROR_CODES, ROLE_PERMISSIONS } from '../config/constants.js';
import { getPrisma } from '../lib/db.js';

/**
 * Security #4 (2026-08-09): the access token may arrive either as an
 * `Authorization: Bearer` header (mobile's only path, and the web app's
 * path before this change) or as the `access_token` httpOnly cookie (the
 * web app's path as of this change). The header wins when both are present
 * -- an explicit credential should never be silently shadowed by an
 * ambient cookie -- which also means this can never change mobile's
 * existing behavior, since mobile never sends the cookie at all.
 */
function resolveAccessToken(req: Request): string | null {
  const headerToken = extractTokenFromHeader(req.headers.authorization);
  if (headerToken) return headerToken;
  return (req.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined) ?? null;
}

// ADR-031 D-3 (PR-3, unconditional as of PR-7): the row shape both
// middlewares read. Selecting only these four columns keeps the added read
// minimal — no other User field is needed to resolve live authorization
// state or validity.
interface LiveUserRow {
  id: string;
  role: string;
  is_active: boolean;
  deleted_at: Date | null;
  token_generation: number;
}

// ADR-031 D-3 (PR-3, unconditional as of PR-7 — FEATURE_DERIVED_PERMISSIONS
// and FEATURE_TOKEN_GENERATION_ENFORCEMENT are retired, both soaks having
// completed; see the PR-7 rollout gate in
// docs/implementation/ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md): shared by
// authMiddleware and optionalAuthMiddleware (C-3 — the two enforcement
// paths must receive identical treatment) to resolve live authorization
// state for a verified token payload. Returns null if the account fails
// validity/revocation checks; throws only when the caller (authMiddleware)
// must hard-fail, via the `onInvalid` callback.
async function resolveLiveAuth(
  payload: ReturnType<typeof verifyAccessToken> & {},
  onInvalid: (code: string, message: string) => void
): Promise<{ role: string; permissions: string[] } | null> {
  const prisma = getPrisma();
  const user = (await prisma.user.findUnique({
    where: { id: payload!.sub },
    select: { id: true, role: true, is_active: true, deleted_at: true, token_generation: true },
  })) as LiveUserRow | null;

  if (!user || !user.is_active || user.deleted_at !== null) {
    onInvalid(ERROR_CODES.UNAUTHORIZED, 'Account is inactive or no longer exists');
    return null;
  }

  // ADR-031 D-3.2: a claim-less token (`token_generation` absent) is
  // rejected outright, never coerced to generation 0 — `'token_generation'
  // in payload` is checked explicitly (never a non-null assertion) rather
  // than trusting the type declaration, which claims the field is always
  // present.
  const hasClaim = 'token_generation' in (payload as object) && payload!.token_generation !== undefined;
  if (!hasClaim || payload!.token_generation !== user.token_generation) {
    onInvalid(ERROR_CODES.TOKEN_REVOKED, 'Token has been revoked');
    return null;
  }

  return {
    role: user.role.toLowerCase(),
    permissions: ROLE_PERMISSIONS[user.role] ?? [],
  };
}

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = resolveAccessToken(req);

    if (!token) {
      throw new UnauthorizedError('Missing authentication token');
    }

    const payload = verifyAccessToken(token);
    if (!payload) {
      throw new UnauthorizedError('Invalid or expired token');
    }

    let invalidError: UnauthorizedError | null = null;
    const derived = await resolveLiveAuth(payload, (code, message) => {
      invalidError = new UnauthorizedError(message, code);
    });
    if (invalidError) {
      throw invalidError;
    }

    req.auth = {
      userId: payload.sub,
      email: payload.email,
      role: derived!.role,
      permissions: derived!.permissions,
      scope: payload.scope ?? null,
    };

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
    } else {
      next(new UnauthorizedError('Authentication failed'));
    }
  }
}

export async function optionalAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = resolveAccessToken(req);

    if (token) {
      const payload = verifyAccessToken(token);
      if (payload) {
        // ADR-031 C-3: identical treatment to authMiddleware — a revoked or
        // inactive account must leave req.auth unset here too, not fall back
        // to trusting a stale claim, and never partially populated.
        let invalid = false;
        const derived = await resolveLiveAuth(payload, () => {
          invalid = true;
        });

        if (!invalid) {
          req.auth = {
            userId: payload.sub,
            email: payload.email,
            role: derived!.role,
            permissions: derived!.permissions,
            scope: payload.scope ?? null,
          };
        }
      }
    }
  } catch (_error) {
    // Ignore auth errors for optional auth — req.auth stays unset, never
    // partially populated (ADR-031 C-3).
  }

  next();
}

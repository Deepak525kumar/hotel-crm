import { Request, Response, NextFunction } from 'express';
import { extractTokenFromHeader, verifyAccessToken } from '../lib/jwt.js';
import { UnauthorizedError } from '../lib/errors.js';
import { ERROR_CODES, ROLE_PERMISSIONS } from '../config/constants.js';
import { isDerivedPermissionsEnabled, isTokenGenerationEnforcementEnabled } from '../config/feature-flags.js';
import { getPrisma } from '../lib/db.js';

// ADR-031 D-3 (PR-3): the row shape both middlewares read. Selecting only
// these four columns keeps the added read minimal — no other User field is
// needed to resolve live authorization state or validity.
interface LiveUserRow {
  id: string;
  role: string;
  is_active: boolean;
  deleted_at: Date | null;
  token_generation: number;
}

// ADR-031 D-3 (PR-3): shared by authMiddleware and optionalAuthMiddleware
// (C-3 — the two enforcement paths must receive identical treatment) to
// resolve live authorization state for a verified token payload. Returns
// null if the account fails validity/revocation checks; throws only when
// the caller (authMiddleware) must hard-fail, via the `onInvalid` callback.
async function resolveLiveAuth(
  payload: ReturnType<typeof verifyAccessToken> & {},
  onInvalid: (code: string, message: string) => void
): Promise<{ role: string; permissions: string[] } | null> {
  const derivedEnabled = isDerivedPermissionsEnabled();
  const enforcementEnabled = isTokenGenerationEnforcementEnabled();

  // Both flags off: today's behavior, byte-for-byte (ADR-031 C-4). No DB
  // read at all in this branch — the whole point of a flag-gated cutover
  // is that "off" costs nothing beyond what already runs today.
  if (!derivedEnabled && !enforcementEnabled) {
    return null;
  }

  const prisma = getPrisma();
  const user = (await prisma.user.findUnique({
    where: { id: payload!.sub },
    select: { id: true, role: true, is_active: true, deleted_at: true, token_generation: true },
  })) as LiveUserRow | null;

  if (!user || !user.is_active || user.deleted_at !== null) {
    onInvalid(ERROR_CODES.UNAUTHORIZED, 'Account is inactive or no longer exists');
    return null;
  }

  if (enforcementEnabled) {
    // ADR-031 D-3.2: a token issued before PR-2 carries no claim at all.
    // Explicitly treat that as generation 0 (the fallback `?? 0`, never a
    // non-null assertion) rather than trusting the type declaration, which
    // says the field is always present — it is not, for any token issued
    // before this cutover.
    const claimGeneration = payload!.token_generation ?? 0;
    if (claimGeneration !== user.token_generation) {
      onInvalid(ERROR_CODES.TOKEN_REVOKED, 'Token has been revoked');
      return null;
    }
  }

  if (!derivedEnabled) {
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
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

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
      role: derived?.role ?? payload.role,
      permissions: derived?.permissions ?? payload.permissions ?? [],
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
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (token) {
      const payload = verifyAccessToken(token);
      if (payload) {
        // ADR-031 C-3: identical treatment to authMiddleware — a revoked or
        // inactive account must leave req.auth unset here too, not fall back
        // to trusting the stale claim, and never partially populated.
        let invalid = false;
        const derived = await resolveLiveAuth(payload, () => {
          invalid = true;
        });

        if (!invalid) {
          req.auth = {
            userId: payload.sub,
            email: payload.email,
            role: derived?.role ?? payload.role,
            permissions: derived?.permissions ?? payload.permissions ?? [],
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

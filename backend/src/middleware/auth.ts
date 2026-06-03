import { Request, Response, NextFunction } from 'express';
import { extractTokenFromHeader, verifyAccessToken } from '../lib/jwt.js';
import { UnauthorizedError } from '../lib/errors.js';

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

    req.auth = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      hotel_ids: payload.hotel_ids || [],
      permissions: payload.permissions || [],
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

export function optionalAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (token) {
      const payload = verifyAccessToken(token);
      if (payload) {
        req.auth = {
          userId: payload.sub,
          email: payload.email,
          role: payload.role,
          hotel_ids: payload.hotel_ids || [],
          permissions: payload.permissions || [],
        };
      }
    }
  } catch (error) {
    // Ignore auth errors for optional auth
  }

  next();
}

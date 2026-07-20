import { Request, Response, NextFunction } from 'express';
import { HotelWorkerStatus } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getPrisma } from '../lib/db.js';

export function requirePermission(permissions: string | string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
    const userPermissions = req.auth.permissions || [];

    // Check if user has admin:* or super_admin role (implicit all permissions)
    if (req.auth.role === 'super_admin' || userPermissions.includes('admin:*')) {
      logger.info('Permission check allowed by role', {
        userId: req.auth.userId,
        role: req.auth.role,
        required: requiredPermissions,
        requestId: req.requestId,
      });
      next();
      return;
    }

    // Check if user has all required permissions
    const hasPermission = requiredPermissions.every((permission) => {
      return (
        userPermissions.includes(permission) ||
        // Check for wildcard permissions (e.g., "users:*" covers "users:read")
        userPermissions.some((userPerm) => {
          const [userResource] = userPerm.split(':');
          const [requiredResource] = permission.split(':');
          return userPerm.endsWith(':*') && userResource === requiredResource;
        })
      );
    });

    if (!hasPermission) {
      logger.warn('Permission check denied', {
        userId: req.auth.userId,
        role: req.auth.role,
        required: requiredPermissions,
        userPermissions,
        requestId: req.requestId,
      });
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    logger.info('Permission check allowed', {
      userId: req.auth.userId,
      role: req.auth.role,
      required: requiredPermissions,
      requestId: req.requestId,
    });

    next();
  };
}

export function requireRole(roles: string | string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const requiredRoles = Array.isArray(roles) ? roles : [roles];
    const hasRole = requiredRoles.includes(req.auth.role);

    if (!hasRole) {
      logger.warn('Role check denied', {
        userId: req.auth.userId,
        role: req.auth.role,
        required: requiredRoles,
        requestId: req.requestId,
      });
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    logger.info('Role check allowed', {
      userId: req.auth.userId,
      role: req.auth.role,
      requestId: req.requestId,
    });

    next();
  };
}

export type HotelAccessDecision =
  // `viaBypass: true` = admin/manager/checker role bypass (PATCH-04 §4c), no DB
  // query performed. `viaBypass: false` = allowed via an ACTIVE HotelWorker
  // membership row. Callers use this to reproduce the pre-refactor log
  // behavior exactly (the bypass path never logged a scope-check line).
  | { allowed: true; viaBypass: boolean }
  | { allowed: false; reason: 'missing_hotel_id' | 'no_membership' };

// Single role->scope resolution seam for hotel-level access (Epic 3 / Execution
// Plan §2 "Shared authorization centralization seam"). Every consumer of
// checkHotelAccess() goes through this one function, so a future scope-model
// change (Epic 5's authz flip, ADR-023) has exactly one place to change
// allow/deny behavior instead of nine call sites. This extraction changes no
// allow/deny outcome — see the characterization suite in
// `__tests__/rbac.test.ts`, which locks current behavior for every role.
export async function resolveHotelAccess(
  role: string,
  userId: string,
  hotelId: string | undefined,
): Promise<HotelAccessDecision> {
  // Admins, managers, and checkers bypass hotel membership check (PATCH-04 §4c).
  // Checkers are quality staff that operate across hotels and are not on the worker roster.
  if (role === 'admin' || role === 'manager' || role === 'checker') {
    return { allowed: true, viaBypass: true };
  }

  if (!hotelId) {
    return { allowed: false, reason: 'missing_hotel_id' };
  }

  const prisma = getPrisma();
  const membership = await prisma.hotelWorker.findFirst({
    where: {
      hotel_id: hotelId,
      worker_id: userId,
      status: HotelWorkerStatus.ACTIVE,
    },
    select: { id: true },
  });

  return membership ? { allowed: true, viaBypass: false } : { allowed: false, reason: 'no_membership' };
}

export function checkHotelAccess() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const hotelId = (req.params.hotel_id || req.query.hotel_id || req.body?.hotel_id) as string | undefined;

    try {
      const decision = await resolveHotelAccess(req.auth.role, req.auth.userId, hotelId);

      if (!decision.allowed) {
        if (decision.reason === 'missing_hotel_id') {
          logger.warn('Hotel scope check: no hotel_id provided', {
            userId: req.auth.userId,
            role: req.auth.role,
            requestId: req.requestId,
          });
          next(new ForbiddenError('Hotel ID is required'));
          return;
        }

        logger.warn('Hotel scope check denied', {
          userId: req.auth.userId,
          role: req.auth.role,
          requestedHotel: hotelId,
          requestId: req.requestId,
        });
        next(new ForbiddenError(`Cannot access hotel ${hotelId}`));
        return;
      }

      if (!decision.viaBypass) {
        logger.debug('Hotel scope check allowed', {
          userId: req.auth.userId,
          role: req.auth.role,
          hotelId,
          requestId: req.requestId,
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

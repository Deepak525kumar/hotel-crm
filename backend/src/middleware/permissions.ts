import { Request, Response, NextFunction } from 'express';
import { HotelWorkerStatus } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getPrisma } from '../lib/db.js';
import { isScopeAuthzEnabled } from '../config/feature-flags.js';
import type { UserScope } from '../lib/jwt.js';

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
  // `viaBypass: true` = admin/checker role bypass (PATCH-04 §4c), or manager
  // bypass while the scope-authz flag is OFF (ADR-024 D3 rollback); no DB
  // query is performed for the scope decision. `viaBypass: false` = allowed
  // either via an ACTIVE HotelWorker membership row (worker) or via a matching
  // manager scope claim (Epic 5 PR 5.5 authz flip). Callers use this to
  // reproduce the pre-refactor log behavior exactly (the bypass path never
  // logged a scope-check line).
  | { allowed: true; viaBypass: boolean }
  | { allowed: false; reason: 'missing_hotel_id' | 'no_membership' | 'out_of_scope' };

// Evaluates whether a manager's PR 5.4 JWT `scope` claim grants access to the
// given hotel (Epic 5 PR 5.5, ADR-024). null scope denies; global allows; hotel
// scope allows only the matching hotel; hotel_group scope allows any hotel whose
// hotel_group_id matches (one findUnique to resolve the target hotel's group).
export async function isHotelInScope(scope: UserScope | null, hotelId: string): Promise<boolean> {
  if (!scope) return false;
  if (scope.type === 'global') return true;
  if (scope.type === 'hotel') return scope.hotel_id === hotelId;
  // hotel_group
  const prisma = getPrisma();
  const hotel = await prisma.hotel.findUnique({
    where: { id: hotelId },
    select: { hotel_group_id: true },
  });
  return !!hotel && hotel.hotel_group_id === scope.hotel_group_id;
}

// Single role->scope resolution seam for hotel-level access (Epic 3 / Execution
// Plan §2 "Shared authorization centralization seam"). Every consumer of
// checkHotelAccess() goes through this one function, so the Epic 5 authz flip
// (ADR-023 / ADR-024) has exactly one place to change allow/deny behavior
// instead of nine call sites. Admin and checker keep their cross-hotel bypass
// unchanged; the manager role is now scope-bound via the PR 5.4 `scope` claim
// whenever the FEATURE_SCOPE_AUTHZ flag is enabled (default), and reverts to the
// old bypass when it is off (ADR-024 D3 compatibility guarantee). See the
// characterization suite in `__tests__/rbac.test.ts`.
export async function resolveHotelAccess(
  role: string,
  userId: string,
  hotelId: string | undefined,
  scope: UserScope | null = null,
): Promise<HotelAccessDecision> {
  // Admins and checkers bypass hotel membership check (PATCH-04 §4c).
  // Checkers are quality staff that operate across hotels and are not on the worker roster.
  if (role === 'admin' || role === 'checker') {
    return { allowed: true, viaBypass: true };
  }

  if (role === 'manager') {
    // Compatibility guarantee (ADR-024 D3): with the scope-authz flag OFF the
    // manager keeps the pre-fix cross-hotel bypass.
    if (!isScopeAuthzEnabled()) {
      return { allowed: true, viaBypass: true };
    }
    if (!hotelId) {
      return { allowed: false, reason: 'missing_hotel_id' };
    }
    return (await isHotelInScope(scope, hotelId))
      ? { allowed: true, viaBypass: false }
      : { allowed: false, reason: 'out_of_scope' };
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
      const decision = await resolveHotelAccess(
        req.auth.role,
        req.auth.userId,
        hotelId,
        req.auth.scope ?? null,
      );

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

        // `no_membership` (worker) and `out_of_scope` (manager, Epic 5 PR 5.5)
        // both deny with the same ForbiddenError shape and log line.
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

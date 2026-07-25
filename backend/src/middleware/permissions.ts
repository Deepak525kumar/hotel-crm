import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isScopeAuthzEnabled } from '../config/feature-flags.js';
import { isWorkerEligibleForHotel } from '../lib/roster-scope.js';
import { isHotelInScope, isWorkerInGroupScope } from '../lib/scope.js';
import type { UserScope } from '../lib/jwt.js';

export function requirePermission(permissions: string | string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
    const userPermissions = req.auth.permissions || [];

    // Check if user has admin:* (implicit all permissions). ADR-030 C-14: a
    // 'super_admin' role bypass previously lived here too, granting blanket
    // permission-check bypass to a role string no enum, schema, or issuance
    // path produces anywhere in the repository. Removed as dead code with no
    // legitimate caller.
    if (userPermissions.includes('admin:*')) {
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
  // either via a group-scope-eligible worker or via a matching
  // manager scope claim (Epic 5 PR 5.5 authz flip). Callers use this to
  // reproduce the pre-refactor log behavior exactly (the bypass path never
  // logged a scope-check line).
  | { allowed: true; viaBypass: boolean }
  | { allowed: false; reason: 'missing_hotel_id' | 'no_membership' | 'out_of_scope' };

// Re-exported from `lib/scope.ts` (moved there in Epic 5 PR 5.7 to break a
// circular import with `lib/roster-scope.ts`, which also needs this
// primitive). Existing call sites (`attendance/service.ts`,
// `quality/service.ts`) keep importing it from here unchanged.
export { isHotelInScope } from '../lib/scope.js';

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

  // Worker roster access (Epic 5 PR 5.7/5.8, ADR-022/024): reads the PR 5.6
  // EmploymentRecord group-grain scope via `lib/roster-scope.ts`.
  const eligible = await isWorkerEligibleForHotel(userId, hotelId);
  return eligible ? { allowed: true, viaBypass: false } : { allowed: false, reason: 'no_membership' };
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

export type WorkerAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: 'missing_worker_id' | 'out_of_scope' };

// Worker-id-keyed counterpart to resolveHotelAccess()/checkHotelAccess(), for
// routes whose payload carries a worker_id rather than a hotel_id (ADR-030
// PR-1, C-10 — HR contracts/payroll/documents). Admin bypasses; manager is
// scope-bound via isWorkerInGroupScope() (group-grain, matching how the
// employment record itself is scoped, REQ-EMP-012); every other role denies —
// no role other than admin/manager currently holds any hr:* permission, so
// this is defense-in-depth against a future grant, not a live restriction
// today. Honors the same ADR-024 D3 compatibility guarantee every other
// scoped module already does: flag off reproduces the pre-existing
// (unscoped) manager behavior.
export async function resolveWorkerScope(
  role: string,
  workerId: string | undefined,
  scope: UserScope | null,
): Promise<WorkerAccessDecision> {
  if (role === 'admin') return { allowed: true };
  if (!workerId) return { allowed: false, reason: 'missing_worker_id' };

  if (role === 'manager') {
    if (!isScopeAuthzEnabled()) return { allowed: true };
    const inScope = await isWorkerInGroupScope(scope, workerId);
    return inScope ? { allowed: true } : { allowed: false, reason: 'out_of_scope' };
  }

  return { allowed: false, reason: 'out_of_scope' };
}

export function checkWorkerScope() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const workerId = (req.params.worker_id || req.body?.worker_id) as string | undefined;

    try {
      const decision = await resolveWorkerScope(req.auth.role, workerId, req.auth.scope ?? null);

      if (!decision.allowed) {
        if (decision.reason === 'missing_worker_id') {
          logger.warn('Worker scope check: no worker_id provided', {
            userId: req.auth.userId,
            role: req.auth.role,
            requestId: req.requestId,
          });
          next(new ForbiddenError('Worker ID is required'));
          return;
        }

        logger.warn('Worker scope check denied', {
          userId: req.auth.userId,
          role: req.auth.role,
          requestedWorker: workerId,
          requestId: req.requestId,
        });
        next(new ForbiddenError(`Cannot access worker ${workerId}`));
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

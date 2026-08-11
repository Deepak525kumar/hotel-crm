import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isGD02MatrixEnabled } from '../config/feature-flags.js';
import { isWorkerEligibleForHotel } from '../lib/roster-scope.js';
import { isHotelInScope, isWorkerInGroupScope, isScopedManagerRole } from '../lib/scope.js';
import type { UserScope } from '../lib/jwt.js';

// Repository convention: `requirePermission()`'s array form is an AND check
// (every() below) — it cannot express "token A for role X, token B for role
// Y" on a single route. If a route needs a different permission token per
// caller role (e.g. a worker-self-service route alongside an admin/manager
// route at the same path), write a small named wrapper function that
// branches on `req.auth.role` and calls `requirePermission()` with the
// resolved token — see hr/routes.ts's `requireContractReadAccess()` for the
// reference implementation.
//
// Any such wrapper MUST declare its full token set via a structured comment
// directly above its `function` declaration, so the static D-8
// permission-token-hygiene test (__tests__/support/route-registry.ts) can
// discover the tokens it checks — that parser only recognizes literal
// `requirePermission('...')` calls made directly inside a route
// registration, and cannot see a check performed inside a named wrapper's
// own body:
//   // @requiresPermission hr:read hr:contract:read-own
//   function requireContractReadAccess() { ... }
// Omitting this annotation does not weaken runtime security (the wrapper
// still enforces the check) — it only makes the token invisible to the
// static hygiene test, which will then report it as an unchecked/orphaned
// permission token.
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

// ADR-030 PR-5 (§6, "Behind FEATURE_GD02_MATRIX"): a handful of route gates
// narrow or rename as part of enacting §3's capability matrix, but their
// REQUIRED token/role must not simply flip in source — `ROLE_PERMISSIONS`
// (a source constant) has no effect on any existing account's *stored*
// permissions until M-2's backfill runs (permissions are stored, not
// derived — §1 fact 2). These two wrappers read the flag fresh on every
// request (not once at router setup) so the "both-off = current behavior"
// guarantee holds until M-2 has actually run and the flag is flipped.
export function requireRoleFlagged(oldRoles: string | string[], newRoles: string | string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const roles = isGD02MatrixEnabled() ? newRoles : oldRoles;
    requireRole(roles)(req, res, next);
  };
}

export function requirePermissionFlagged(oldToken: string | string[], newToken: string | string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = isGD02MatrixEnabled() ? newToken : oldToken;
    requirePermission(token)(req, res, next);
  };
}

export type HotelAccessDecision =
  // `viaBypass: true` = admin/checker role bypass (PATCH-04 §4c); no DB
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
// NOTE: isScopedManagerRole/isSelfScopedRole (lib/scope.js) are deliberately
// NOT re-exported here. They are pure predicates with no I/O, and several
// suites jest.mock this module to stub isHotelInScope's DB read — a re-export
// would force each of those suites to stub the predicates as well. Service
// modules import them straight from lib/scope.js instead.

// Single role->scope resolution seam for hotel-level access (Epic 3 / Execution
// Plan §2 "Shared authorization centralization seam"). Every consumer of
// checkHotelAccess() goes through this one function, so the Epic 5 authz flip
// (ADR-023 / ADR-024) has exactly one place to change allow/deny behavior
// instead of nine call sites. Admin and checker keep their cross-hotel bypass
// unchanged; the manager role is unconditionally scope-bound via the PR 5.4
// `scope` claim (the FEATURE_SCOPE_AUTHZ rollback flag was retired in
// ADR-030 PR-5, M-4). See the characterization suite in `__tests__/rbac.test.ts`.
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

  // ADR-030 D-5: regional_manager holds manager's operational capability set
  // at hotel_group scope — isHotelInScope() is role-agnostic (it resolves
  // purely from the scope claim's shape, not the caller's role), so the same
  // branch that already serves 'manager' serves 'regional_manager' correctly.
  // Before this, regional_manager fell through to the worker-roster branch
  // below (an unrelated, individual-grain authorization model), which could
  // both wrongly deny an RM within their own group and wrongly allow one
  // outside it via incidental EmploymentRecord rows (security review finding
  // on PR-7's analytics regional_manager/analytics:read fix).
  if (isScopedManagerRole(role)) {
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
// PR-1, C-10 — HR contracts/payroll/documents). Admin bypasses; the scope-bound
// manager roles are constrained via isWorkerInGroupScope() (group-grain,
// matching how the employment record itself is scoped, REQ-EMP-012); every
// other role denies.
//
// `regional_manager` is included via isScopedManagerRole(). It was previously
// absent, and the comment here justified the omission with "no role other than
// admin/manager currently holds any hr:* permission" — which was false once
// ROLE_PERMISSIONS aliased REGIONAL_MANAGER to MANAGER_PERMISSIONS
// (config/constants.ts), giving RM `hr:read`/`hr:write`. The effect was that an
// RM holding the ratified C-29/C-30 tokens was hard-denied on every
// checkWorkerScope()-guarded HR and Documents route, even inside its own group
// — the exact defect shape SIR-AUTH-021 recorded for resolveHotelAccess().
// isWorkerInGroupScope() is role-agnostic and group-grain, so it serves an RM's
// hotel_group claim correctly with no further change.
export async function resolveWorkerScope(
  role: string,
  workerId: string | undefined,
  scope: UserScope | null,
  actorId?: string,
): Promise<WorkerAccessDecision> {
  if (role === 'admin') return { allowed: true };
  if (!workerId) return { allowed: false, reason: 'missing_worker_id' };
  // ADR-065 self-service: a Manager/RM applicant's own record has no
  // hotel_group_id yet (set only on activation), so isWorkerInGroupScope()
  // always denies self-reads pre-assignment. Check self-access before the
  // group-scope branch, same ordering as employee-management's assertVisibility.
  if (actorId && actorId === workerId) return { allowed: true };

  if (isScopedManagerRole(role)) {
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
      const decision = await resolveWorkerScope(req.auth.role, workerId, req.auth.scope ?? null, req.auth.userId);

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

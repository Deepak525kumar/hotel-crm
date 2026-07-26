import { Request, Response, NextFunction } from 'express';
import { analyticsService } from './service.js';
import { resolveNonAdminScopeFilter } from '../../lib/scope.js';
import { UnauthorizedError } from '../../lib/errors.js';
import type { UserScope } from '../../lib/jwt.js';

// ADR-030 PR-4 (D-7): the bare /leaderboard and /stats routes have no
// checkHotelAccess() middleware and previously accepted an unvalidated
// client `?hotel_id` — a manager could pass any hotel_id (or none, for
// every hotel/group) and read cross-tenant analytics. The `/by-hotel/
// :hotel_id` and `/hotel-summary/:hotel_id` routes are unaffected: they
// already scope-check the path param via checkHotelAccess() before this
// controller ever runs, so `pathHotelId` is trusted as-is.
// Default-deny shape (security review FIND-01): admin is the only explicit
// bypass, not a `{manager, regional_manager}` allowlist — any other role
// reaching this far (or added to this route's guard later without a
// matching update here) is scope-resolved, never trusted with a raw client
// hotel_id. See the matching note in users/service.ts listUsers.
async function resolveScopedFilter(
  auth: { role: string; scope?: UserScope | null },
  pathHotelId: string | undefined,
  clientHotelId: string | undefined
): Promise<{ hotelId?: string; hotelGroupId?: string }> {
  if (pathHotelId) return { hotelId: pathHotelId };
  if (auth.role === 'admin') {
    // Admin: honor the client filter as before, including "no filter" =
    // every hotel/group.
    return { hotelId: clientHotelId };
  }

  // Every non-admin actor: the client-supplied hotel_id is never trusted
  // here — the actor's own JWT scope claim is the only source of the filter.
  // `resolveNonAdminScopeFilter` enforces (and logs) the invariant that a
  // non-admin actor never resolves to global scope, rather than silently
  // returning unfiltered on that "shouldn't occur" case.
  const scopeFilter = await resolveNonAdminScopeFilter(auth.role, auth.scope ?? null);
  if (scopeFilter.kind === 'deny') return { hotelGroupId: '__none__' };
  return { hotelGroupId: scopeFilter.hotelGroupId };
}

export class AnalyticsController {
  async getLeaderboard(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const { hotelId, hotelGroupId } = await resolveScopedFilter(
        req.auth,
        req.params.hotel_id,
        req.query.hotel_id as string | undefined
      );
      const result = await analyticsService.getLeaderboard(hotelId, hotelGroupId);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async getDashboardStats(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const { hotelId, hotelGroupId } = await resolveScopedFilter(
        req.auth,
        req.params.hotel_id,
        req.query.hotel_id as string | undefined
      );
      const result = await analyticsService.getDashboardStats(hotelId, hotelGroupId);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async getHotelSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await analyticsService.getHotelSummary(req.params.hotel_id);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const analyticsController = new AnalyticsController();

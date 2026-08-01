import { Request, Response, NextFunction } from 'express';
import { retentionService } from './service.js';
import { GetDeletionAuditLogQuerySchema, CheckEligibilityQuerySchema } from './types.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

// SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN), PR 5 of 5. Only the two
// query interfaces (GetDeletionAuditLog, CheckEligibility) are routed --
// RegisterCategory/TagRecord remain in-process-only by design (spec's own
// Trust boundaries/authorization section: invoked by a consuming module's
// own trusted backend logic, never an end-user-facing caller). Both routed
// endpoints require only authentication (any authenticated role), not a
// specific role/permission -- OD-RETENTION-05 (Admin RBAC scope for
// GetDeletionAuditLog) is explicitly OPEN, so no Admin-only gate is added
// here; CheckEligibility's own spec row names no "Admin" caller class at
// all. module_id/category_id/record_ref are always taken from the query
// string, never derived from req.auth, since -- unlike Consent's worker-
// scoped interfaces -- these values identify a consuming MODULE's own
// category/record, not the calling user's own data; there is no "self"
// concept to enforce here.
export class RetentionController {
  async getDeletionAuditLog(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const parsed = GetDeletionAuditLogQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
        return;
      }

      const result = await retentionService.getDeletionAuditLog(parsed.data);

      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: {
          page: parsed.data.page,
          per_page: parsed.data.per_page,
          total: result.total,
          total_pages: Math.ceil(result.total / parsed.data.per_page),
          has_next: parsed.data.page * parsed.data.per_page < result.total,
          has_prev: parsed.data.page > 1,
        },
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async checkEligibility(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const parsed = CheckEligibilityQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
        return;
      }

      const result = await retentionService.checkEligibility(parsed.data);

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

export const retentionController = new RetentionController();

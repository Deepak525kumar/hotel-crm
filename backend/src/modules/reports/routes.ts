import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { reportService } from './service.js';
import { DateRangeSchema, ReportDatasetSchema, ReportFormatSchema } from './types.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import type { Request, Response, NextFunction } from 'express';

const router = Router();
router.use(authMiddleware);

function parseRange(req: Request) {
  const parsed = DateRangeSchema.safeParse({ from: req.query.from, to: req.query.to });
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid date range',
      parsed.error.issues.map((i) => ({ field: String(i.path[0] ?? 'range'), message: i.message }))
    );
  }
  return parsed.data;
}

// Team reporting: read a dataset over a date range.
// @requiresPermission reports:read-team
router.get(
  '/data',
  requirePermission('reports:read-team'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const dataset = ReportDatasetSchema.parse(req.query.dataset);
      const result = await reportService.queryDataset({
        dataset,
        range: parseRange(req),
        actor: req.auth,
        scope: 'team',
      });
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Team export: the same rows as a downloadable file.
// @requiresPermission reports:export-team
router.post(
  '/export',
  requirePermission('reports:export-team'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const dataset = ReportDatasetSchema.parse(req.body?.dataset);
      const format = ReportFormatSchema.exclude(['json']).parse(req.body?.format);
      const range = DateRangeSchema.parse({ from: req.body?.from, to: req.body?.to });

      const report = await reportService.generateReport({
        dataset,
        range,
        format,
        actor: req.auth,
      });
      res.status(200).json({
        status: 'success',
        data: report,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
);

// EVERY user's own data. This is the GDPR Article 15/20 right of access and
// portability, not a management feature -- it carries the self token that
// every role holds, and is deliberately NOT gated by role.
// @requiresPermission reports:export-own
router.post(
  '/export/mine',
  requirePermission('reports:export-own'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new UnauthorizedError();
      // Defaults to the last year rather than requiring a range: a person
      // exercising a data-access right should not have to know one.
      const today = new Date().toISOString().slice(0, 10);
      const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      const range = DateRangeSchema.parse({
        from: req.body?.from ?? yearAgo,
        to: req.body?.to ?? today,
      });

      const report = await reportService.exportOwnData({ actor: req.auth, range });
      res.status(200).json({
        status: 'success',
        data: report,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

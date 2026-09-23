import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { reportService } from './service.js';
import { DateRangeSchema, ReportDatasetSchema, ReportFormatSchema } from './types.js';
// The SEMANTIC day validator, shared with types.ts -- `2026-02-30` must not
// roll to March 2 on the export path either.
import { isoDate } from '../../lib/zod-primitives.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import type { Request, Response, NextFunction } from 'express';

const router = Router();
router.use(authMiddleware);

/**
 * Body validation for the export routes.
 *
 * These used a bare `.parse()` until 2026-09-23, so a MISSING FIELD threw a
 * raw ZodError that the error handler rendered as `500 INTERNAL_ERROR`. Two
 * consequences, both bad: the caller was told the server had broken when they
 * had simply omitted `format`, and a genuine 500 in this module was
 * indistinguishable from a validation slip in the logs.
 *
 * `format` and the `from`/`to` range are all REQUIRED here -- that is not new,
 * it just had no readable failure. The mobile client omitted every one of
 * them and so could never export at all.
 */
function parseExportBody(body: unknown) {
  const shape = z.object({
    dataset: ReportDatasetSchema,
    format: ReportFormatSchema.exclude(['json']),
    from: isoDate,
    to: isoDate,
  });
  const parsed = shape.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid export request',
      parsed.error.issues.map((i) => ({ field: String(i.path[0] ?? 'body'), message: i.message }))
    );
  }
  // Range semantics (order, 366-day cap) stay with DateRangeSchema so the
  // export path and the read path cannot disagree about what a range is.
  const range = DateRangeSchema.safeParse({ from: parsed.data.from, to: parsed.data.to });
  if (!range.success) {
    throw new ValidationError(
      'Invalid date range',
      range.error.issues.map((i) => ({ field: String(i.path[0] ?? 'range'), message: i.message }))
    );
  }
  return { dataset: parsed.data.dataset, format: parsed.data.format, range: range.data };
}

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
      const { dataset, format, range } = parseExportBody(req.body);

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

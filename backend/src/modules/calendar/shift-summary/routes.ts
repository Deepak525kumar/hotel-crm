import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../../middleware/auth.js';
import { checkHotelAccess, requireRole } from '../../../middleware/permissions.js';
import { ShiftSummaryService, dailyShiftSummarySchema } from './service.js';
import { UnauthorizedError, ValidationError } from '../../../lib/errors.js';

export const router = Router({ mergeParams: true });
const service = new ShiftSummaryService();

// GET /hotels/:hotel_id/shift-summaries?start_date=2026-08-01&end_date=2026-08-31
router.get(
  '/',
  authMiddleware,
  requireRole(['admin', 'regional_manager', 'manager']),
  checkHotelAccess(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { hotel_id } = req.params;
      const { start_date, end_date } = req.query;

      if (!start_date || !end_date) {
        throw new ValidationError('start_date and end_date are required');
      }

      const start = new Date(start_date as string);
      const end = new Date(end_date as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new ValidationError('Invalid date format');
      }

      const summaries = await service.getSummariesByDateRange(hotel_id, start, end);
      // Every other route in this codebase wraps its success response in the
      // standard { status: 'success', data, meta } envelope (see
      // calendar/controller.ts's sibling methods) -- apiFetch on the
      // frontend unconditionally expects it and otherwise silently returns
      // `undefined` from a bare-array response (found via a real browser
      // session: "Cannot read properties of undefined (reading 'length')" in
      // ShiftSummaryPanel, despite the row existing and the PUT having
      // succeeded -- verified in Postgres).
      res.status(200).json({
        status: 'success',
        data: summaries,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /hotels/:hotel_id/shift-summaries/:date
router.put(
  '/:date',
  authMiddleware,
  requireRole(['admin', 'regional_manager', 'manager']),
  checkHotelAccess(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { hotel_id, date } = req.params;

      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        throw new ValidationError('Invalid date format');
      }

      const payload = dailyShiftSummarySchema.parse(req.body);
      const actorId = req.auth?.userId;
      if (!actorId) {
        throw new UnauthorizedError();
      }
      const summary = await service.upsertSummary(hotel_id, parsedDate, payload, actorId);

      // Same envelope fix as the GET route above.
      res.status(200).json({
        status: 'success',
        data: summary,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (err) {
      next(err);
    }
  }
);

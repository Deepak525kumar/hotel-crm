import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../../middleware/auth.js';
import { checkHotelAccess, requireRole } from '../../../middleware/permissions.js';
import { ShiftSummaryService, dailyShiftSummarySchema } from './service.js';

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
        res.status(400).json({ error: 'start_date and end_date are required' });
        return;
      }

      const start = new Date(start_date as string);
      const end = new Date(end_date as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ error: 'Invalid date format' });
        return;
      }

      const summaries = await service.getSummariesByDateRange(hotel_id, start, end);
      res.json(summaries);
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
        res.status(400).json({ error: 'Invalid date format' });
        return;
      }

      const payload = dailyShiftSummarySchema.parse(req.body);
      const user = (req as any).user;
      const summary = await service.upsertSummary(hotel_id, parsedDate, payload, user.id || user.userId);
      
      res.json(summary);
    } catch (err) {
      next(err);
    }
  }
);

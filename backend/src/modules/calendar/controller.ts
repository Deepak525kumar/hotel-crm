import { Request, Response, NextFunction } from 'express';
import { calendarService } from './service.js';
import { MarkAbsenceSchema } from './types.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

export class CalendarController {
  async getDailyOperations(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await calendarService.getDailyOperations(
        req.params.hotel_id,
        req.query.date as string
      );
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async createDailyOperation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await calendarService.createDailyOperation(req.params.hotel_id, req.body);
      res.status(201).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // REQ-CAL-T02
  async getOwnAbsences(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await calendarService.getOwnAbsences(req.auth.userId);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // REQ-CAL-T03/T04/T08
  async markAbsence(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const parsed = MarkAbsenceSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
        return;
      }
      const result = await calendarService.markAbsence(req.auth.userId, parsed.data);
      res.status(201).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const calendarController = new CalendarController();

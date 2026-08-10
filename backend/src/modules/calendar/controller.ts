import { Request, Response, NextFunction } from 'express';
import { calendarService } from './service.js';
import {
  MarkAbsenceSchema,
  MarkAbsenceForWorkerSchema,
  MoveCalendarAbsenceSchema,
  ListAbsencesQuerySchema,
} from './types.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

export class CalendarController {
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

  // Manager/RM/admin marks or corrects an absence on a worker's behalf
  // (2026-08-08 feature).
  async markAbsenceForWorker(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const parsed = MarkAbsenceForWorkerSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
        return;
      }
      const result = await calendarService.markAbsenceForWorker(parsed.data, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope,
      });
      res.status(201).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // Drag-to-move on the calendar grid (2026-08-08 feature).
  async moveAbsence(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const parsed = MoveCalendarAbsenceSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
        return;
      }
      const result = await calendarService.moveAbsence(req.params.id, parsed.data, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope,
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

  // Delete an absence
  async deleteAbsence(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      await calendarService.deleteAbsence(req.params.id, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope,
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // New (calendar grid view): manager/regional_manager/admin view of
  // absences across their scoped team.
  async listAbsences(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const parsed = ListAbsencesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
        return;
      }
      const result = await calendarService.listAbsences(parsed.data, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope,
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

  // REQ-CAL-T06 (IF-CAL-GetAvailability/v0)
  async getAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const workerId = (req.query.worker_id as string | undefined) ?? req.auth.userId;
      const result = await calendarService.getAvailability(workerId, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope,
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
}

export const calendarController = new CalendarController();

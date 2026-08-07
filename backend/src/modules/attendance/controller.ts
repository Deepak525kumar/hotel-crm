import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../lib/errors.js';
import { attendanceService } from './service.js';
import { CheckInSchema, ListAttendanceQuerySchema, UpdateAttendanceSchema } from './types.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

export async function checkIn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = CheckInSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await attendanceService.checkIn(
      parsed.data,
      req.auth!.userId,
      req.auth!.role,
      req.ip
    );
    res.status(201).json({
      status: 'success',
      data: result,
      meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
    });
  } catch (error) {
    next(error);
  }
}

export async function listAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = ListAttendanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
      return;
    }
    const { data, total } = await attendanceService.list(parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    const { page, per_page } = parsed.data;
    res.status(200).json({
      status: 'success',
      data,
      pagination: {
        page,
        per_page,
        total,
        total_pages: Math.ceil(total / per_page),
        has_next: page * per_page < total,
        has_prev: page > 1,
      },
      meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
    });
  } catch (error) {
    next(error);
  }
}

export async function getAttendanceById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await attendanceService.getById(req.params.id, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
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

export async function updateAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = UpdateAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await attendanceService.update(
      req.params.id,
      parsed.data,
      req.auth!.userId,
      req.auth!.role,
      req.auth!.scope ?? null
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

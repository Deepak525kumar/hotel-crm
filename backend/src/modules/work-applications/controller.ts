import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../lib/errors.js';
import { workApplicationService } from './service.js';
import {
  ApplyWorkRequestSchema,
  ListApplicationsQuerySchema,
  UpdateApplicationSchema,
} from './types.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

export async function applyToWorkRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = ApplyWorkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await workApplicationService.apply(
      req.params.id,
      parsed.data,
      req.auth!.userId,
      req.auth!.role
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

export async function listApplications(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = ListApplicationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
      return;
    }
    const { data, total } = await workApplicationService.list(
      req.params.id,
      parsed.data,
      { userId: req.auth!.userId, role: req.auth!.role }
    );
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

export async function updateApplication(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = UpdateApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await workApplicationService.update(
      req.params.id,
      req.params.applicationId,
      parsed.data,
      {
        userId: req.auth!.userId,
        role: req.auth!.role,
        scope: req.auth!.scope ?? null,
      }
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

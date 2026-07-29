import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../lib/errors.js';
import { sendPaginated, sendSuccess } from '../../lib/http-envelope.js';
import { jobRequestService } from './service.js';
import {
  CreateWorkRequestSchema,
  ListWorkRequestsQuerySchema,
  UpdateWorkRequestSchema,
} from './types.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

export async function createWorkRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = CreateWorkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await jobRequestService.create(parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { statusCode: 201, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

export async function listWorkRequests(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = ListWorkRequestsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
      return;
    }
    const { data, total } = await jobRequestService.list(parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
    });
    const { page, per_page } = parsed.data;
    sendPaginated(
      res,
      data,
      {
        page,
        per_page,
        total,
        total_pages: Math.ceil(total / per_page),
        has_next: page * per_page < total,
        has_prev: page > 1,
      },
      { requestId: req.requestId }
    );
  } catch (error) {
    next(error);
  }
}

export async function getWorkRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await jobRequestService.getById(req.params.id, {
      userId: req.auth!.userId,
      role: req.auth!.role,
    });
    sendSuccess(res, result, { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

export async function updateWorkRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = UpdateWorkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await jobRequestService.update(req.params.id, parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

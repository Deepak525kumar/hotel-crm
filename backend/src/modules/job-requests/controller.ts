import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../lib/errors.js';
import { sendPaginated, sendSuccess } from '../../lib/http-envelope.js';
import { jobRequestService } from './service.js';
import {
  AcceptBroadcastSchema,
  CreateWorkRequestSchema,
  ListWorkRequestsQuerySchema,
  RaiseBroadcastSchema,
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

// Epic 9 PR 9.7 (TREQ-002/TRULE-002, MIG-GAP-04/05).
export async function raiseBroadcast(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = RaiseBroadcastSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await jobRequestService.raiseBroadcast(parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { statusCode: 201, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

// Epic 9 PR 9.7 (TREQ-003/TRULE-002/TRULE-006, MIG-GAP-04).
export async function getBroadcastEligibility(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await jobRequestService.getBroadcastEligibility(req.params.id, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

// Epic 9 PR 9.9 (TREQ-004/TREQ-005, MIG-GAP-06).
export async function acceptBroadcast(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = AcceptBroadcastSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await jobRequestService.acceptBroadcast(req.params.id, parsed.data.skill, {
      userId: req.auth!.userId,
      role: req.auth!.role,
    });
    sendSuccess(res, result, {
      statusCode: result.status === 'accepted' ? 201 : 200,
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
}

// Epic 9 PR 9.10 (TREQ-006/TRULE-005, MIG-GAP-09).
export async function manualCloseBroadcast(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await jobRequestService.manualClose(req.params.id, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      scope: req.auth!.scope ?? null,
    });
    sendSuccess(res, result, { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

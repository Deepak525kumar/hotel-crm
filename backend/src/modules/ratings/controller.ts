import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../lib/errors.js';
import { ratingService } from './service.js';
import { CreateRatingSchema, ListRatingsQuerySchema } from './types.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

export async function createRating(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = CreateRatingSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const result = await ratingService.create(parsed.data, req.auth!.userId, req.auth!.role);
    res.status(201).json({
      status: 'success',
      data: result,
      meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
    });
  } catch (error) {
    next(error);
  }
}

export async function listRatings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = ListRatingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
      return;
    }
    const { data, total } = await ratingService.list(parsed.data, {
      userId: req.auth!.userId,
      role: req.auth!.role,
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

export async function getRating(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await ratingService.getById(req.params.id, {
      userId: req.auth!.userId,
      role: req.auth!.role,
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

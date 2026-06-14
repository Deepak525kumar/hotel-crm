import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../lib/errors.js';
import { leaderboardService } from './service.js';
import { LeaderboardQuerySchema } from './types.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

function paginated(
  res: Response,
  req: Request,
  data: unknown[],
  total: number,
  page: number,
  per_page: number
) {
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
}

export async function getGlobalLeaderboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = LeaderboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
      return;
    }
    const { data, total } = await leaderboardService.global(parsed.data);
    paginated(res, req, data, total, parsed.data.page, parsed.data.per_page);
  } catch (error) {
    next(error);
  }
}

export async function getHotelLeaderboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = LeaderboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
      return;
    }
    const { data, total } = await leaderboardService.byHotel(req.params.hotel_id, parsed.data);
    paginated(res, req, data, total, parsed.data.page, parsed.data.per_page);
  } catch (error) {
    next(error);
  }
}

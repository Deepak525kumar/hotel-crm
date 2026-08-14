import { Request, Response, NextFunction } from 'express';
import { qualityService } from './service.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { CreateQualityVerificationSchema, CreateRatingSchema, ListLeaderboardQuerySchema } from './types.js';

export class QualityController {
  async createVerification(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = CreateQualityVerificationSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);
      const result = await qualityService.createVerification(parsed.data, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope ?? null,
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

  async createRating(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = CreateRatingSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);
      const result = await qualityService.createRating(parsed.data, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope ?? null,
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

  async getLeaderboard(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = ListLeaderboardQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);
      const { leaderboard, pagination } = await qualityService.getLeaderboard(
        req.params.hotel_id || '',
        parsed.data.page,
        parsed.data.per_page,
        { userId: req.auth.userId, role: req.auth.role, scope: req.auth.scope ?? null }
      );
      res.status(200).json({
        status: 'success',
        data: leaderboard,
        pagination,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const qualityController = new QualityController();

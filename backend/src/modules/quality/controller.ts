import { Request, Response, NextFunction } from 'express';
import { qualityService } from './service.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { CreateQualityVerificationSchema } from './types.js';
import type { CreateRatingRequest } from './types.js';

export class QualityController {
  async createVerification(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = CreateQualityVerificationSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0].message);
      }
      const result = await qualityService.createVerification(parsed.data, req.auth);
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
      const result = await qualityService.createRating(req.body as CreateRatingRequest, {
        userId: req.auth.userId,
        role: req.auth.role,
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
      const result = await qualityService.getLeaderboard(req.params.hotel_id || '');
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

export const qualityController = new QualityController();

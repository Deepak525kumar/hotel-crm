import { Request, Response, NextFunction } from 'express';
import { qualityService } from './service.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import {
  AssignReworkSchema,
  CompleteReworkSchema,
  CreateQualityVerificationSchema,
  CreateRatingSchema,
  ListLeaderboardQuerySchema,
} from './types.js';
import type { UploadedPhoto } from './types.js';

/**
 * Files arrive via multer's memory storage, so each is already a Buffer.
 * Normalised here rather than in the service so the service stays
 * transport-agnostic and unit-testable without Express.
 */
function photosFrom(req: Request): UploadedPhoto[] {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  return files.map((f) => ({
    buffer: f.buffer,
    mimeType: f.mimetype,
    originalName: f.originalname,
  }));
}

export class QualityController {
  async createVerification(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = CreateQualityVerificationSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);
      const result = await qualityService.createVerification(
        parsed.data,
        { userId: req.auth.userId, role: req.auth.role, scope: req.auth.scope ?? null },
        photosFrom(req)
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

  // CRR §14: checker assigns rework to a specific worker.
  async assignRework(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = AssignReworkSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);
      const result = await qualityService.assignRework(parsed.data, {
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

  // CRR §14: worker uploads a photo and marks the rework done.
  async completeRework(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = CompleteReworkSchema.safeParse({ assignment_id: req.params.assignment_id });
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);
      const result = await qualityService.completeRework(
        parsed.data.assignment_id,
        photosFrom(req),
        { userId: req.auth.userId, role: req.auth.role, scope: req.auth.scope ?? null }
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

  // The inspection record itself, so a client can show the score/status and
  // decide whether rework is still assignable. Same gate as the photos below.
  async getVerification(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const id = req.params.verification_id;
      if (!id) throw new ValidationError('verification_id is required');
      const result = await qualityService.getVerification(id, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope ?? null,
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

  // CRR §14/§15: serve the evidence so the checker can actually see what they
  // were notified with. Keys alone are useless -- the bucket is private.
  async getVerificationPhotos(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const id = req.params.verification_id;
      if (!id) throw new ValidationError('verification_id is required');
      const result = await qualityService.getVerificationPhotos(id, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope ?? null,
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

  async createRating(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = CreateRatingSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);
      const result = await qualityService.createRating(
        parsed.data,
        {
          userId: req.auth.userId,
          role: req.auth.role,
          scope: req.auth.scope ?? null,
        },
        photosFrom(req)
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

  async getRatingPhotos(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const id = req.params.rating_id;
      if (!id) throw new ValidationError('rating_id is required');
      const result = await qualityService.getRatingPhotos(id, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope ?? null,
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

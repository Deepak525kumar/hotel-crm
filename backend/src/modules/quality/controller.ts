import { Request, Response, NextFunction } from 'express';
import { qualityService } from './service.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import {
  AssignReworkSchema,
  CompleteReworkSchema,
  CreateQualityVerificationSchema,
  ListLeaderboardQuerySchema,
  ListOwnInspectionsQuerySchema,
  RecordInspectionSchema,
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

  // One inspection, one request: both records, the aggregate refresh, any
  // rework assignment and exactly one notification, in a single transaction
  // from a single photo upload.
  async recordInspection(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = RecordInspectionSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const photos: UploadedPhoto[] = files.map((f) => ({
        buffer: f.buffer,
        mimeType: f.mimetype,
        originalName: f.originalname,
      }));

      const result = await qualityService.recordInspection(
        parsed.data as never,
        { userId: req.auth.userId, role: req.auth.role, scope: req.auth.scope ?? null },
        photos
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

  async listInspectableWorkers(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const rawDay = req.query.day;
      const day = typeof rawDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : undefined;
      if (typeof rawDay === 'string' && day === undefined) {
        throw new ValidationError('day must be YYYY-MM-DD');
      }
      const result = await qualityService.listInspectableWorkers(
        { userId: req.auth.userId, role: req.auth.role, scope: req.auth.scope ?? null },
        day
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

  // CRR §14/§15: the checker's own inspection history. Self-scoped in the
  // service off req.auth.userId -- there is deliberately no `checker_id` or
  // `user_id` query parameter to spoof.
  async listOwnChecks(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const parsed = ListOwnInspectionsQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError(parsed.error.errors[0].message);
      const result = await qualityService.listOwnChecks(
        { userId: req.auth.userId, role: req.auth.role, scope: req.auth.scope ?? null },
        { page: parsed.data.page, perPage: parsed.data.per_page, q: parsed.data.q }
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

  // Every check recorded against one shift. Backs the worker's shift screen
  // and, for a checker or manager, the same shift opened from their side.
  async listChecksForAssignment(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const id = req.params.assignment_id;
      if (!id) throw new ValidationError('assignment_id is required');
      const result = await qualityService.listChecksForAssignment(id, {
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

  // One check, in the shape both the worker's and the checker's detail screen
  // render -- deliberately the same payload, so the two cannot drift.
  async getCheck(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const id = req.params.check_id;
      if (!id) throw new ValidationError('check_id is required');
      const result = await qualityService.getCheck(id, {
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

  async getCheckForRework(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError('Not authenticated');
      const id = req.params.assignment_id;
      if (!id) throw new ValidationError('assignment_id is required');
      const result = await qualityService.getCheckForReworkAssignment(id, {
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

// SPEC-GEO-001 @0.1.2 FROZEN (GD-14 Decided 2026-07-27).
// Thin HTTP adapter: parses/validates request shape, derives the actor
// exclusively from req.auth, and delegates to GeoService.

import { Request, Response, NextFunction } from 'express';
import { geoService } from './service.js';
import { CheckinSchema, ListCheckinsQuerySchema } from './types.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

export class GeoController {
  // IF-GEO-DISTANCE-CHECK: self-checkin only -- worker_id is always
  // req.auth.userId, never a client-supplied field.
  async checkIn(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const parsed = CheckinSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
        return;
      }

      const result = await geoService.checkIn(
        req.auth.userId,
        parsed.data,
        req.auth.role,
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

  async listCheckins(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const parsed = ListCheckinsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
        return;
      }

      const result = await geoService.listCheckins(parsed.data, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope,
      });

      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: {
          page: parsed.data.page,
          per_page: parsed.data.per_page,
          total: result.total,
          total_pages: Math.ceil(result.total / parsed.data.per_page),
          has_next: parsed.data.page * parsed.data.per_page < result.total,
          has_prev: parsed.data.page > 1,
        },
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async getCheckin(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const result = await geoService.getCheckin(req.params.checkin_id, {
        userId: req.auth.userId,
        role: req.auth.role,
        scope: req.auth.scope,
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
}

export const geoController = new GeoController();

import { Request, Response, NextFunction } from 'express';
import { crmService } from './service.js';
import {
  CreateHotelSchema, UpdateHotelSchema,
  ListHotelsQuerySchema,
  CreateHotelGroupSchema, UpdateHotelGroupSchema,
  ListHotelGroupsQuerySchema,
} from './types.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { UnauthorizedError } from '../../lib/errors.js';

export class CrmController {
  listHotels = [
    validateQuery(ListHotelsQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await crmService.listHotels(
          req.query as never,
          req.auth.role,
          req.auth.userId,
          req.auth.scope ?? null
        );
        res.status(200).json({
          status: 'success',
          data: result.hotels,
          pagination: result.pagination,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async getHotel(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const hotel = await crmService.getHotel(req.params['hotel_id']!, req.auth.userId, req.auth.role, req.ip);
      res.status(200).json({
        status: 'success',
        data: hotel,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  createHotel = [
    validateBody(CreateHotelSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const hotel = await crmService.createHotel(req.body, req.auth.userId, req.auth.role, req.ip);
        res.status(201).json({
          status: 'success',
          data: hotel,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  updateHotel = [
    validateBody(UpdateHotelSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const hotel = await crmService.updateHotel(req.params['hotel_id']!, req.body, req.auth.userId, req.auth.role, req.ip);
        res.status(200).json({
          status: 'success',
          data: hotel,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async deleteHotel(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      await crmService.deleteHotel(req.params['hotel_id']!, req.auth.userId, req.auth.role, req.ip);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // Entity lifecycle (2026-08-07): ACTIVE <-> DEACTIVATED for temporary
  // operational changes, and -> DELETED -> restore for permanent removal
  // from operations with history preserved. See crm/service.ts for why the
  // two are distinct in kind rather than degree.
  async deactivateHotel(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await crmService.deactivateHotel(
        req.params['hotel_id']!,
        req.auth.userId,
        req.auth.role,
        req.ip
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async reactivateHotel(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await crmService.reactivateHotel(
        req.params['hotel_id']!,
        req.auth.userId,
        req.auth.role,
        req.ip
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async restoreHotel(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await crmService.restoreHotel(
        req.params['hotel_id']!,
        req.auth.userId,
        req.auth.role,
        req.ip
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async deactivateHotelGroup(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await crmService.deactivateHotelGroup(
        req.params['hotel_group_id']!,
        req.auth.userId,
        req.auth.role,
        req.ip
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async reactivateHotelGroup(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await crmService.reactivateHotelGroup(
        req.params['hotel_group_id']!,
        req.auth.userId,
        req.auth.role,
        req.ip
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async restoreHotelGroup(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await crmService.restoreHotelGroup(
        req.params['hotel_group_id']!,
        req.auth.userId,
        req.auth.role,
        req.ip
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  // ── Hotel Groups (Epic 5 PR 5.2) ────────────────────────────────────────────

  listHotelGroups = [
    validateQuery(ListHotelGroupsQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await crmService.listHotelGroups(req.query as never, {
          role: req.auth.role,
          scope: req.auth.scope ?? null,
        });
        res.status(200).json({
          status: 'success',
          data: result.hotelGroups,
          pagination: result.pagination,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async getHotelGroup(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const hotelGroup = await crmService.getHotelGroup(req.params['hotel_group_id']!, req.auth.userId, req.auth.role, req.auth.scope ?? null, req.ip);
      res.status(200).json({
        status: 'success',
        data: hotelGroup,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  createHotelGroup = [
    validateBody(CreateHotelGroupSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const hotelGroup = await crmService.createHotelGroup(req.body, req.auth.userId, req.auth.role, req.ip);
        res.status(201).json({
          status: 'success',
          data: hotelGroup,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  updateHotelGroup = [
    validateBody(UpdateHotelGroupSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const hotelGroup = await crmService.updateHotelGroup(req.params['hotel_group_id']!, req.body, req.auth.userId, req.auth.role, req.ip);
        res.status(200).json({
          status: 'success',
          data: hotelGroup,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async deleteHotelGroup(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      await crmService.deleteHotelGroup(req.params['hotel_group_id']!, req.auth.userId, req.auth.role, req.ip);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export const crmController = new CrmController();

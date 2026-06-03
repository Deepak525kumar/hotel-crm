import { Request, Response, NextFunction } from 'express';
import { crmService } from './service.js';

/**
 * CRM Controller
 *
 * Handles HTTP requests for:
 * - Hotels: GET /api/v1/hotels, POST, PUT, DELETE
 * - Rooms: GET /api/v1/hotels/:hotel-id/rooms
 * - Tasks: GET /api/v1/tasks, POST, PUT
 * - Photos: POST /api/v1/tasks/:id/photos
 *
 * IMPORTANT: Implementation deferred to later phase
 */
export class CrmController {
  async listHotels(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await crmService.listHotels(req.query);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async createHotel(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await crmService.createHotel(req.body);
      res.status(201).json({
        status: 'success',
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getHotel(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await crmService.getHotel(req.params.hotel_id);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async createTask(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await crmService.createTask(req.params.hotel_id, req.body);
      res.status(201).json({
        status: 'success',
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async uploadPhoto(_req: Request, _res: Response, next: NextFunction) {
    try {
      // TODO: Handle file upload
      throw new Error('Not implemented');
    } catch (error) {
      next(error);
    }
  }
}

export const crmController = new CrmController();

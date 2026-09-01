import { Request, Response, NextFunction } from 'express';
import { roomService } from './service.js';
import {
  LogRoomSchema,
  UpdateRoomLogSchema,
  ListRoomsQuerySchema,
  RoomPickerQuerySchema,
  RoomSuggestionsQuerySchema,
} from './types.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { UnauthorizedError } from '../../lib/errors.js';

/**
 * Thin HTTP adapter. Every actor field is derived from `req.auth` -- no route
 * here accepts a worker_id, hotel_id-as-identity or role from the client, so
 * there is no request shape in which a caller can act as somebody else.
 */
export class RoomController {
  private static ok(req: Request, res: Response, data: unknown, status = 200) {
    res.status(status).json({
      status: 'success',
      data,
      meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
    });
  }

  logRoom = [
    validateBody(LogRoomSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const room = await roomService.logRoom(
          req.params['assignment_id']!,
          req.body.room_number,
          req.auth,
          req.ip
        );
        RoomController.ok(req, res, room, 201);
      } catch (error) {
        next(error);
      }
    },
  ];

  updateRoom = [
    validateBody(UpdateRoomLogSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const room = await roomService.updateRoom(
          req.params['room_log_id']!,
          req.body.room_number,
          req.auth,
          req.ip
        );
        RoomController.ok(req, res, room);
      } catch (error) {
        next(error);
      }
    },
  ];

  async deleteRoom(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      await roomService.deleteRoom(req.params['room_log_id']!, req.auth, req.ip);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  listMyRooms = [
    validateQuery(ListRoomsQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await roomService.listMyRooms(req.auth, req.query['day'] as string | undefined);
        RoomController.ok(req, res, result);
      } catch (error) {
        next(error);
      }
    },
  ];

  listRoomsForPicker = [
    validateQuery(RoomPickerQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await roomService.listRoomsForPicker(req.auth, {
          day: req.query['day'] as string | undefined,
          hotel_id: req.query['hotel_id'] as string | undefined,
        });
        RoomController.ok(req, res, result);
      } catch (error) {
        next(error);
      }
    },
  ];

  listRoomsForHotels = [
    validateQuery(RoomPickerQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await roomService.listRoomsForHotels(req.auth, {
          day: req.query['day'] as string | undefined,
          hotel_id: req.query['hotel_id'] as string | undefined,
        });
        RoomController.ok(req, res, result);
      } catch (error) {
        next(error);
      }
    },
  ];

  listSuggestions = [
    validateQuery(RoomSuggestionsQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const rooms = await roomService.listRoomSuggestions(req.auth, req.query['hotel_id'] as string);
        RoomController.ok(req, res, { rooms });
      } catch (error) {
        next(error);
      }
    },
  ];
}

export const roomController = new RoomController();

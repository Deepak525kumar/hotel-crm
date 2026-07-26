import { Request, Response, NextFunction } from 'express';
import { userService } from './service.js';
import { CreateUserSchema, UpdateUserSchema, ListUsersQuerySchema } from './types.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { UnauthorizedError } from '../../lib/errors.js';

export class UserController {
  listUsers = [
    validateQuery(ListUsersQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const result = await userService.listUsers(req.query as never, {
          role: req.auth.role,
          scope: req.auth.scope ?? null,
        });
        res.status(200).json({
          status: 'success',
          data: result.users,
          pagination: result.pagination,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async getUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const user = await userService.getUser(req.params['user_id']!, req.auth.userId, req.auth.role, req.ip);
      res.status(200).json({
        status: 'success',
        data: user,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  createUser = [
    validateBody(CreateUserSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const user = await userService.createUser(req.body, req.auth.userId, req.auth.role, req.ip);
        res.status(201).json({
          status: 'success',
          data: user,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  updateUser = [
    validateBody(UpdateUserSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const user = await userService.updateUser(req.params['user_id']!, req.body, req.auth.userId, req.auth.role, req.ip);
        res.status(200).json({
          status: 'success',
          data: user,
          meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  ];

  async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      await userService.deleteUser(req.params['user_id']!, req.auth.userId, req.auth.role, req.ip);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();

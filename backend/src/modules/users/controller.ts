import { Request, Response, NextFunction } from 'express';
import { userService } from './service.js';
import {
  CreateUserSchema,
  UpdateUserSchema,
  UpdateUserProfileSchema,
  UpdateUserRoleSchema,
  ListUsersQuerySchema,
} from './types.js';
import { validateBody, validateQuery } from '../../middleware/validation.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { isGD02MatrixEnabled } from '../../config/feature-flags.js';

// Matches the zodDetails() helper already duplicated per-controller in
// attendance/work-requests/assignments — kept local rather than extracted
// to a shared lib, consistent with that existing (if repeated) convention.
function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

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
      const user = await userService.getUser(req.params['user_id']!, req.auth.userId, req.auth.role, req.auth.scope ?? null, req.ip);
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
        const user = await userService.createUser(req.body, req.auth, req.ip);
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

  // ADR-030 D-4a: split by FEATURE_GD02_MATRIX rather than two separate
  // routes, since the legacy combined schema/method must keep working
  // unconditionally while the flag is off (rollback guarantee) — the flag
  // is read per-request, not baked into the route's middleware chain, so
  // `validateBody` (a static, single-schema middleware) doesn't fit here.
  updateUser = [
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();

        if (!isGD02MatrixEnabled()) {
          const parsed = UpdateUserSchema.safeParse(req.body);
          if (!parsed.success) {
            throw new ValidationError('Request body validation failed', zodDetails(parsed.error));
          }
          const user = await userService.updateUser(
            req.params['user_id']!,
            parsed.data,
            req.auth.userId,
            req.auth.role,
            req.auth.scope ?? null,
            req.ip
          );
          res.status(200).json({
            status: 'success',
            data: user,
            meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
          });
          return;
        }

        // A `role` key (or any other unrecognized field) fails here at the
        // schema boundary — it is never read, let alone passed to the
        // service (ADR-030 D-4a).
        const parsed = UpdateUserProfileSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ValidationError('Request body validation failed', zodDetails(parsed.error));
        }
        const user = await userService.updateUserProfile(
          req.params['user_id']!,
          parsed.data,
          req.auth.userId,
          req.auth.role,
          req.auth.scope ?? null,
          req.ip
        );
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

  // ADR-030 D-4a: the dedicated Admin-only role-assignment endpoint. Mounted
  // unconditionally (additive, harmless while unused) — see users/routes.ts.
  updateUserRole = [
    validateBody(UpdateUserRoleSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.auth) throw new UnauthorizedError();
        const user = await userService.updateUserRole(req.params['user_id']!, req.body, req.auth.userId, req.auth.role, req.auth.scope ?? null, req.ip);
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

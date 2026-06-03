import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function requirePermission(permissions: string | string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
    const userPermissions = req.auth.permissions || [];

    // Check if user has admin:* or super_admin role (implicit all permissions)
    if (req.auth.role === 'super_admin' || userPermissions.includes('admin:*')) {
      logger.info('Permission check allowed by role', {
        userId: req.auth.userId,
        role: req.auth.role,
        required: requiredPermissions,
        requestId: req.requestId,
      });
      next();
      return;
    }

    // Check if user has all required permissions
    const hasPermission = requiredPermissions.every((permission) => {
      return (
        userPermissions.includes(permission) ||
        // Check for wildcard permissions (e.g., "users:*" covers "users:read")
        userPermissions.some((userPerm) => {
          const [userResource] = userPerm.split(':');
          const [requiredResource] = permission.split(':');
          return userPerm.endsWith(':*') && userResource === requiredResource;
        })
      );
    });

    if (!hasPermission) {
      logger.warn('Permission check denied', {
        userId: req.auth.userId,
        role: req.auth.role,
        required: requiredPermissions,
        userPermissions,
        requestId: req.requestId,
      });
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    logger.info('Permission check allowed', {
      userId: req.auth.userId,
      role: req.auth.role,
      required: requiredPermissions,
      requestId: req.requestId,
    });

    next();
  };
}

export function requireRole(roles: string | string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const requiredRoles = Array.isArray(roles) ? roles : [roles];
    const hasRole = requiredRoles.includes(req.auth.role);

    if (!hasRole) {
      logger.warn('Role check denied', {
        userId: req.auth.userId,
        role: req.auth.role,
        required: requiredRoles,
        requestId: req.requestId,
      });
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    logger.info('Role check allowed', {
      userId: req.auth.userId,
      role: req.auth.role,
      requestId: req.requestId,
    });

    next();
  };
}

export function checkHotelAccess() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    // Admins can access all hotels
    if (req.auth.role === 'admin') {
      next();
      return;
    }

    // For managers and other roles, check if they have access to the requested hotel
    const hotelId = req.params.hotel_id || req.query.hotel_id || req.body?.hotel_id;

    if (!hotelId) {
      logger.warn('Hotel scope check: no hotel_id provided', {
        userId: req.auth.userId,
        role: req.auth.role,
        requestId: req.requestId,
      });
      next(new ForbiddenError('Hotel ID is required'));
      return;
    }

    if (!req.auth.hotel_ids.includes(hotelId as string)) {
      logger.warn('Hotel scope check denied', {
        userId: req.auth.userId,
        role: req.auth.role,
        requestedHotel: hotelId,
        allowedHotels: req.auth.hotel_ids,
        requestId: req.requestId,
      });
      next(
        new ForbiddenError(
          `Cannot access hotel ${hotelId}. Allowed hotels: ${req.auth.hotel_ids.join(', ')}`
        )
      );
      return;
    }

    logger.debug('Hotel scope check allowed', {
      userId: req.auth.userId,
      role: req.auth.role,
      hotelId,
      requestId: req.requestId,
    });

    next();
  };
}

import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import {
  AppError,
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  ValidationError,
  isAppError,
} from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { captureException } from '../lib/error-tracker.js';
import { HTTP_STATUS, ERROR_CODES } from '../config/constants.js';
import { getEnv } from '../config/env.js';

/**
 * Maps known Prisma errors to AppError instances so the response formatting
 * below stays centralized. Returns null for unrecognized errors.
 */
function mapPrismaError(error: Error): AppError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return new ConflictError('A record with this value already exists');
      case 'P2025':
        return new NotFoundError('Resource not found');
      case 'P2003':
        return new ValidationError('Related record constraint failed');
      default:
        return null;
    }
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return new InvalidRequestError('Invalid database request');
  }
  return null;
}

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const env = getEnv();
  const request_id = req.requestId || 'unknown';

  // Centralized Prisma error mapping: translate to AppError so formatting below applies
  const mappedPrismaError = mapPrismaError(error);
  if (mappedPrismaError) {
    error = mappedPrismaError;
  }

  // Log all errors
  if (isAppError(error)) {
    logger.error('Application error', {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      request_id,
      ...(env.NODE_ENV === 'development' && { stack: error.stack }),
    });
  } else {
    logger.error('Unexpected error', {
      message: error.message,
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      request_id,
      ...(env.NODE_ENV === 'development' && { stack: error.stack }),
    });

    // Forward unexpected (non-application) errors to the error-tracking seam.
    // SyntaxError (malformed JSON body) is a 4xx client fault, not a server
    // fault, so it is excluded to keep the error-tracking signal actionable.
    if (!(error instanceof SyntaxError)) {
      captureException(error, { request_id, source: 'error_handler' });
    }
  }

  // Format error response per API_STANDARDS.md
  if (isAppError(error)) {
    res.status(error.statusCode).json({
      status: 'error',
      error: {
        code: error.code,
        message: error.message,
        ...(error.details.length > 0 && { details: error.details }),
      },
      meta: {
        timestamp: new Date().toISOString(),
        request_id,
      },
    });
  } else {
    // Generic error response
    const statusCode =
      error instanceof SyntaxError ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.INTERNAL_SERVER_ERROR;

    res.status(statusCode).json({
      status: 'error',
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message:
          env.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : error.message,
      },
      meta: {
        timestamp: new Date().toISOString(),
        request_id,
      },
    });
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  const request_id = req.requestId || 'unknown';
  res.status(HTTP_STATUS.NOT_FOUND).json({
    status: 'error',
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: 'Resource not found',
    },
    meta: {
      timestamp: new Date().toISOString(),
      request_id,
    },
  });
}

import { Request, Response, NextFunction } from 'express';
import { isAppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { HTTP_STATUS, ERROR_CODES } from '../config/constants.js';
import { getEnv } from '../config/env.js';

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const env = getEnv();
  const request_id = req.requestId || 'unknown';

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

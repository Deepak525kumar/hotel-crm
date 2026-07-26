import { ERROR_CODES, HTTP_STATUS } from '../config/constants.js';

export interface ErrorDetail {
  field?: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public details: ErrorDetail[] = []
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: ErrorDetail[] = []) {
    super(ERROR_CODES.VALIDATION_ERROR, HTTP_STATUS.UNPROCESSABLE_ENTITY, message, details);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class UnauthorizedError extends AppError {
  // ADR-031 D-3.2 (PR-3): optional `code` override so callers that need a
  // machine-readable distinction (e.g. TOKEN_REVOKED vs the default
  // UNAUTHORIZED) don't need a bespoke error class per code.
  constructor(message: string = 'Unauthorized', code: string = ERROR_CODES.UNAUTHORIZED) {
    super(code, HTTP_STATUS.UNAUTHORIZED, message);
    this.name = 'UnauthorizedError';
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(ERROR_CODES.FORBIDDEN, HTTP_STATUS.FORBIDDEN, message);
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(ERROR_CODES.NOT_FOUND, HTTP_STATUS.NOT_FOUND, message);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super(ERROR_CODES.CONFLICT, HTTP_STATUS.CONFLICT, message);
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class InvalidRequestError extends AppError {
  constructor(message: string = 'Invalid request') {
    super(ERROR_CODES.INVALID_REQUEST, HTTP_STATUS.BAD_REQUEST, message);
    this.name = 'InvalidRequestError';
    Object.setPrototypeOf(this, InvalidRequestError.prototype);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error') {
    super(ERROR_CODES.INTERNAL_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR, message);
    this.name = 'InternalServerError';
    Object.setPrototypeOf(this, InternalServerError.prototype);
  }
}

export class NotImplementedError extends AppError {
  constructor(message: string = 'Not implemented') {
    super(ERROR_CODES.NOT_IMPLEMENTED, HTTP_STATUS.NOT_IMPLEMENTED, message);
    this.name = 'NotImplementedError';
    Object.setPrototypeOf(this, NotImplementedError.prototype);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(ERROR_CODES.SERVICE_UNAVAILABLE, HTTP_STATUS.SERVICE_UNAVAILABLE, message);
    this.name = 'ServiceUnavailableError';
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

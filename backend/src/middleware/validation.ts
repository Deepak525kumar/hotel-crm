import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError, ErrorDetail } from '../lib/errors.js';

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.body);
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details: ErrorDetail[] = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        next(new ValidationError('Request body validation failed', details));
      } else {
        next(error);
      }
    }
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.query);
      req.query = validated as Record<string, string>;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details: ErrorDetail[] = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        next(new ValidationError('Query validation failed', details));
      } else {
        next(error);
      }
    }
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.params);
      req.params = validated as Record<string, string>;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details: ErrorDetail[] = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        next(new ValidationError('Parameters validation failed', details));
      } else {
        next(error);
      }
    }
  };
}

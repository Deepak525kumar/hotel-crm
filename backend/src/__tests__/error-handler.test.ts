import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'test' }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { errorHandler } from '../middleware/errorHandler.js';

function makeReq(): Request {
  return { requestId: 'req_test' } as unknown as Request;
}

function makeRes(): { status: jest.Mock; json: jest.Mock } {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('prisma error', {
    code,
    clientVersion: 'test',
  });
}

describe('Global Prisma error mapping (P1-01)', () => {
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
  });

  it('maps P2002 to 409 CONFLICT', () => {
    const res = makeRes();
    errorHandler(knownRequestError('P2002'), makeReq(), res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'CONFLICT' }) })
    );
  });

  it('maps P2025 to 404 NOT_FOUND', () => {
    const res = makeRes();
    errorHandler(knownRequestError('P2025'), makeReq(), res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'NOT_FOUND' }) })
    );
  });

  it('maps P2003 to 422 VALIDATION_ERROR', () => {
    const res = makeRes();
    errorHandler(knownRequestError('P2003'), makeReq(), res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) })
    );
  });

  it('maps PrismaClientValidationError to 400 BAD_REQUEST', () => {
    const res = makeRes();
    const err = new Prisma.PrismaClientValidationError('bad query', { clientVersion: 'test' });
    errorHandler(err, makeReq(), res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INVALID_REQUEST' }) })
    );
  });

  it('leaves unrelated errors as 500 INTERNAL_ERROR', () => {
    const res = makeRes();
    errorHandler(new Error('boom'), makeReq(), res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INTERNAL_ERROR' }) })
    );
  });

  // Malformed-JSON error code regression (security review, 2026-08-08):
  // express.json() throws a bare SyntaxError for an unparseable body, which
  // previously got a 400 status but the generic 500-shaped INTERNAL_ERROR
  // code -- a client reading the code, not the status, would misclassify a
  // client-fault (their own malformed JSON) as a server fault.
  it('maps a malformed-JSON SyntaxError to 400 INVALID_REQUEST, not INTERNAL_ERROR', () => {
    const res = makeRes();
    const err = new SyntaxError('Unexpected token } in JSON at position 12');
    errorHandler(err, makeReq(), res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INVALID_REQUEST' }) })
    );
  });
});

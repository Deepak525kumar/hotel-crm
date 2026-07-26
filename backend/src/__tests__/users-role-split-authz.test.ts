import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Route/schema-boundary regression for ADR-030 D-4a (PUT /users/:id split).
 *
 * Locks the ordering constraint from ADR-030 §6: "The DTO/route split lands
 * before the users:write grant is enabled, not after." While
 * FEATURE_GD02_MATRIX is off, PUT /users/:id keeps accepting the legacy
 * combined profile+role body (rollback path). Once on, a `role` key in that
 * same route's body must be rejected at the schema boundary — not merely
 * denied by service logic — and role assignment only works through the
 * new, dedicated, Admin-only PUT /users/:id/role.
 */

let gd02Enabled = false;
let testAuth: { userId: string; role: string; permissions: string[]; scope: unknown } | null = null;

jest.mock('../config/feature-flags.js', () => ({
  isGD02MatrixEnabled: () => gd02Enabled,
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

const updateUser = jest.fn(async () => ({ id: 'u1', role: 'worker' })) as jest.MockedFunction<
  (...args: any[]) => any
>;
const updateUserProfile = jest.fn(async () => ({ id: 'u1', role: 'worker' })) as jest.MockedFunction<
  (...args: any[]) => any
>;
const updateUserRole = jest.fn(async () => ({ id: 'u1', role: 'manager' })) as jest.MockedFunction<
  (...args: any[]) => any
>;

jest.mock('../modules/users/service.js', () => ({
  userService: {
    listUsers: jest.fn(async () => ({ users: [], pagination: {} })),
    getUser: jest.fn(async () => ({ id: 'u1' })),
    createUser: jest.fn(async () => ({ id: 'u1' })),
    updateUser,
    updateUserProfile,
    updateUserRole,
    deleteUser: jest.fn(async () => undefined),
  },
}));

// ADR-031 D-4 (PR-4): users/routes.ts now also wires the Admin-only
// revoke-all-sessions route to authController, which otherwise pulls in the
// real auth/service.js -> config/env.js chain this test never exercises or
// mocks. Out of scope for this file (which is about the D-4a route/schema
// split), so stub it the same way userService is stubbed above.
jest.mock('../modules/auth/controller.js', () => ({
  authController: {
    revokeAllSessions: jest.fn(async (_req: unknown, res: Response) => {
      (res as any).status(200).json({ status: 'success', data: { message: 'All sessions revoked' } });
    }),
  },
}));

import express from 'express';
import request from 'supertest';
import usersRouter from '../modules/users/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/users', usersRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('PUT /users/:id split (ADR-030 D-4a)', () => {
  beforeEach(() => {
    gd02Enabled = false;
    testAuth = null;
    updateUser.mockClear();
    updateUserProfile.mockClear();
    updateUserRole.mockClear();
  });

  it('flag OFF: accepts the legacy combined profile+role body', async () => {
    testAuth = { userId: 'a1', role: 'admin', permissions: ['users:write'], scope: null };
    const res = await request(makeApp()).put('/users/u1').send({ first_name: 'A', role: 'manager' });
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('flag ON: a role-less body succeeds via updateUserProfile', async () => {
    gd02Enabled = true;
    testAuth = { userId: 'm1', role: 'manager', permissions: ['users:write'], scope: { type: 'global' } };
    const res = await request(makeApp()).put('/users/u1').send({ first_name: 'A' });
    expect(res.status).toBe(200);
    expect(updateUserProfile).toHaveBeenCalledTimes(1);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('flag ON: a `role` key in the body is rejected at the schema boundary, never reaching the service', async () => {
    gd02Enabled = true;
    testAuth = { userId: 'a1', role: 'admin', permissions: ['users:write'], scope: null };
    const res = await request(makeApp()).put('/users/u1').send({ first_name: 'A', role: 'manager' });
    expect(res.status).toBe(422);
    expect(updateUserProfile).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('flag ON: an unrecognized key is also rejected (.strict())', async () => {
    gd02Enabled = true;
    testAuth = { userId: 'a1', role: 'admin', permissions: ['users:write'], scope: null };
    const res = await request(makeApp()).put('/users/u1').send({ permissions: ['admin:*'] });
    expect(res.status).toBe(422);
    expect(updateUserProfile).not.toHaveBeenCalled();
  });
});

describe('PUT /users/:id/role (ADR-030 D-4a, always mounted, Admin-only)', () => {
  beforeEach(() => {
    gd02Enabled = false;
    testAuth = null;
    updateUserRole.mockClear();
  });

  it('denies a manager (403), regardless of the flag', async () => {
    testAuth = { userId: 'm1', role: 'manager', permissions: ['users:write'], scope: null };
    const res = await request(makeApp()).put('/users/u1/role').send({ role: 'checker' });
    expect(res.status).toBe(403);
    expect(updateUserRole).not.toHaveBeenCalled();
  });

  it('allows an admin to assign a role', async () => {
    testAuth = { userId: 'a1', role: 'admin', permissions: [], scope: null };
    const res = await request(makeApp()).put('/users/u1/role').send({ role: 'manager' });
    expect(res.status).toBe(200);
    expect(updateUserRole).toHaveBeenCalledTimes(1);
  });

  it('rejects a body carrying a profile field alongside role (.strict())', async () => {
    testAuth = { userId: 'a1', role: 'admin', permissions: [], scope: null };
    const res = await request(makeApp()).put('/users/u1/role').send({ role: 'manager', first_name: 'Sneaky' });
    expect(res.status).toBe(422);
    expect(updateUserRole).not.toHaveBeenCalled();
  });

  it('accepts regional_manager as an assignable role', async () => {
    testAuth = { userId: 'a1', role: 'admin', permissions: [], scope: null };
    const res = await request(makeApp()).put('/users/u1/role').send({ role: 'regional_manager' });
    expect(res.status).toBe(200);
    expect(updateUserRole).toHaveBeenCalledTimes(1);
  });
});

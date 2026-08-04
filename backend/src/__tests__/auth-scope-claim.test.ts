import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';
import jwt from 'jsonwebtoken';

/**
 * Regression suite for Epic 5 PR 5.4 (ADR-023 §6 / ADR-025 §4): the JWT
 * `scope` claim issued by AuthService.resolveScope. Mirrors the mock-Prisma
 * pattern used by auth.test.ts and the JWT-secret decoding pattern used by
 * auth-refresh-secret.test.ts.
 */

const JWT_SECRET = 'test-secret-key-minimum-32-characters-long';

// Mock the Prisma client before any imports that use it
const mockPrisma = {
  user: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  session: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    deleteMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  passwordResetToken: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    deleteMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  auditLog: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotelGroup: {
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotel: {
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)) as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({
  getPrisma: () => mockPrisma,
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET,
    JWT_REFRESH_SECRET: 'test-refresh-secret-minimum-32-chars-x',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { AuthService } from '../modules/auth/service.js';
import { verifyRefreshToken } from '../lib/jwt.js';

function decodeAccessToken(token: string): any {
  return jwt.verify(token, JWT_SECRET);
}

describe('AuthService — JWT scope claim (PR 5.4 / ADR-023 §6 / ADR-025 §4)', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService();
  });

  const baseUser = (overrides: Record<string, unknown>) => ({
    id: 'user_1',
    email: 'user@test.com',
    password_hash: '$2a$12$doesnotmatterhere111111111111111111111',
    first_name: 'A',
    last_name: 'B',
    phone: null,
    profile_photo_url: null,
    is_active: true,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    permissions: [],
    ...overrides,
  });

  // The tests below never exercise the real bcrypt comparison for a matching
  // password (that's covered elsewhere in auth.test.ts) — they stub
  // bcrypt.compare via a real hash generated once here so `login` reaches the
  // token-issuance code path deterministically.
  let realPasswordHash: string;
  beforeAll(async () => {
    const bcrypt = await import('bcryptjs');
    realPasswordHash = await bcrypt.hash('password123', 4);
  });

  describe('login — scope resolution', () => {
    it('ADMIN → scope resolves to { type: "global" } with no association DB reads', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        baseUser({ id: 'admin_1', email: 'admin@test.com', role: 'ADMIN', password_hash: realPasswordHash, permissions: ['admin:*'] })
      );
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.login({ email: 'admin@test.com', password: 'password123' });
      const payload = decodeAccessToken(result.access_token);

      expect(payload.scope).toEqual({ type: 'global' });
      // Existing claims must still be present — no regression to the payload shape.
      expect(payload.sub).toBe('admin_1');
      expect(payload.email).toBe('admin@test.com');
      expect(payload.role).toBe('admin');
      // ADR-031 D-2/PR-5: the permissions claim is dropped from issuance —
      // permissions are derived request-time, never carried on the token.
      expect(payload.permissions).toBeUndefined();

      // Admin short-circuits before any association lookup.
      expect(mockPrisma.hotelGroup.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.hotel.findFirst).not.toHaveBeenCalled();
    });

    // `resolveScope()` is role-agnostic below the admin short-circuit: it
    // resolves by ASSOCIATION (HotelGroup.regional_manager_user_id, then
    // Hotel.manager_user_id), not by role string. Both cases below therefore
    // matter and neither substitutes for the other: a group-associated MANAGER
    // row is what M-3 promotes FROM, and a REGIONAL_MANAGER row is what every
    // live RM actually presents after promotion. This suite previously covered
    // the group-association branch only with `role: 'MANAGER'`, leaving scope
    // issuance for an actual REGIONAL_MANAGER row unexercised.
    it('Regional Manager (REGIONAL_MANAGER row, HotelGroup.regional_manager_user_id match) → { type: "hotel_group", hotel_group_id }', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        baseUser({
          id: 'rm_1',
          email: 'rm@test.com',
          role: 'REGIONAL_MANAGER',
          password_hash: realPasswordHash,
        })
      );
      mockPrisma.hotelGroup.findFirst.mockResolvedValue({ id: 'group_42' });
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.login({ email: 'rm@test.com', password: 'password123' });
      const payload = decodeAccessToken(result.access_token);

      expect(payload.role).toBe('regional_manager');
      expect(payload.scope).toEqual({ type: 'hotel_group', hotel_group_id: 'group_42' });
      expect(mockPrisma.hotelGroup.findFirst).toHaveBeenCalledWith({
        where: { regional_manager_user_id: 'rm_1' },
        select: { id: true },
      });
    });

    it('group-associated MANAGER row (the pre-M-3 shape) → { type: "hotel_group", hotel_group_id }', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        baseUser({ id: 'rm_1', email: 'rm@test.com', role: 'MANAGER', password_hash: realPasswordHash })
      );
      mockPrisma.hotelGroup.findFirst.mockResolvedValue({ id: 'group_42' });
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.login({ email: 'rm@test.com', password: 'password123' });
      const payload = decodeAccessToken(result.access_token);

      expect(payload.role).toBe('manager');
      expect(payload.scope).toEqual({ type: 'hotel_group', hotel_group_id: 'group_42' });
    });

    // An RM row with no HotelGroup association is reachable in production: an
    // Admin can mint one via `PUT /users/:id/role` without appointing them to
    // a group (appointment is a separate, hotel-group-owned write). Scope
    // resolves to `null` and every scope primitive then fails closed
    // (`isHotelInScope`/`resolveScopeGroupFilter` deny on a null claim), so
    // such an RM authenticates successfully and is denied everywhere — pinned
    // here so that stays deliberate rather than becoming an accident.
    it('REGIONAL_MANAGER row with no group and no hotel association → scope null (fails closed downstream)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        baseUser({
          id: 'rm_orphan',
          email: 'orphan@test.com',
          role: 'REGIONAL_MANAGER',
          password_hash: realPasswordHash,
        })
      );
      mockPrisma.hotelGroup.findFirst.mockResolvedValue(null);
      mockPrisma.hotel.findFirst.mockResolvedValue(null);
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.login({ email: 'orphan@test.com', password: 'password123' });
      const payload = decodeAccessToken(result.access_token);

      expect(payload.role).toBe('regional_manager');
      expect(payload.scope).toBeNull();
    });

    it('Hotel Manager (non-admin, hotelGroup miss, Hotel.manager_user_id match) → { type: "hotel", hotel_id }', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        baseUser({ id: 'hm_1', email: 'hm@test.com', role: 'MANAGER', password_hash: realPasswordHash })
      );
      mockPrisma.hotelGroup.findFirst.mockResolvedValue(null);
      mockPrisma.hotel.findFirst.mockResolvedValue({ id: 'hotel_7' });
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.login({ email: 'hm@test.com', password: 'password123' });
      const payload = decodeAccessToken(result.access_token);

      expect(payload.scope).toEqual({ type: 'hotel', hotel_id: 'hotel_7' });
      expect(mockPrisma.hotel.findFirst).toHaveBeenCalledWith({
        where: { manager_user_id: 'hm_1' },
        select: { id: true },
      });
    });

    it('plain worker/checker (both association lookups miss) → scope: null', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        baseUser({ id: 'w_1', email: 'worker@test.com', role: 'WORKER', password_hash: realPasswordHash })
      );
      mockPrisma.hotelGroup.findFirst.mockResolvedValue(null);
      mockPrisma.hotel.findFirst.mockResolvedValue(null);
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.login({ email: 'worker@test.com', password: 'password123' });
      const payload = decodeAccessToken(result.access_token);

      expect(payload.scope).toBeNull();
    });

    it('checker role, both association lookups miss → scope: null', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        baseUser({ id: 'c_1', email: 'checker@test.com', role: 'CHECKER', password_hash: realPasswordHash })
      );
      mockPrisma.hotelGroup.findFirst.mockResolvedValue(null);
      mockPrisma.hotel.findFirst.mockResolvedValue(null);
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.login({ email: 'checker@test.com', password: 'password123' });
      const payload = decodeAccessToken(result.access_token);

      expect(payload.scope).toBeNull();
    });

    it('precedence: user is BOTH regional manager and hotel manager → resolves to hotel_group (RM wins), hotel.findFirst never called', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        baseUser({ id: 'both_1', email: 'both@test.com', role: 'MANAGER', password_hash: realPasswordHash })
      );
      mockPrisma.hotelGroup.findFirst.mockResolvedValue({ id: 'group_99' });
      mockPrisma.hotel.findFirst.mockResolvedValue({ id: 'hotel_99' });
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.login({ email: 'both@test.com', password: 'password123' });
      const payload = decodeAccessToken(result.access_token);

      expect(payload.scope).toEqual({ type: 'hotel_group', hotel_group_id: 'group_99' });
      expect(mockPrisma.hotel.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('signup — scope resolution', () => {
    it('newly created WORKER has scope: null', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(
        baseUser({ id: 'new_worker_1', email: 'newworker@test.com', role: 'WORKER' })
      );
      mockPrisma.hotelGroup.findFirst.mockResolvedValue(null);
      mockPrisma.hotel.findFirst.mockResolvedValue(null);
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.signup({
        email: 'newworker@test.com',
        password: 'password123',
        first_name: 'New',
        last_name: 'Worker',
      });
      const payload = decodeAccessToken(result.access_token);

      expect(payload.scope).toBeNull();
      // resolveScope is still invoked for uniformity, even though it
      // short-circuits to null for a fresh signup with no associations.
      expect(mockPrisma.hotelGroup.findFirst).toHaveBeenCalledWith({
        where: { regional_manager_user_id: 'new_worker_1' },
        select: { id: true },
      });
    });
  });

  describe('refreshToken — scope resolution', () => {
    it('recomputes scope and sets it on the newly issued access token (hotel manager)', async () => {
      // The refresh JWT signature/payload check is independent of our mocked
      // Prisma layer — sign it with the same secret the env mock supplies so
      // verifyRefreshToken (real implementation) accepts it.
      const signedRefresh = jwt.sign({ sub: 'hm_refresh_1', type: 'refresh' }, 'test-refresh-secret-minimum-32-chars-x', {
        expiresIn: '7d',
        algorithm: 'HS256',
      });
      expect(verifyRefreshToken(signedRefresh)?.sub).toBe('hm_refresh_1');

      mockPrisma.session.findFirst.mockResolvedValue({
        id: 'sess_1',
        user_id: 'hm_refresh_1',
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
      });
      mockPrisma.user.findUnique.mockResolvedValue(
        baseUser({ id: 'hm_refresh_1', email: 'hmrefresh@test.com', role: 'MANAGER' })
      );
      mockPrisma.hotelGroup.findFirst.mockResolvedValue(null);
      mockPrisma.hotel.findFirst.mockResolvedValue({ id: 'hotel_55' });
      mockPrisma.session.update.mockResolvedValue({});

      const result = await service.refreshToken({ refresh_token: signedRefresh });
      const payload = decodeAccessToken(result.access_token);

      expect(payload.scope).toEqual({ type: 'hotel', hotel_id: 'hotel_55' });
    });
  });
});

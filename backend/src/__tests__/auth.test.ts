import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

// TREQ-AUTH-007: backs the `user.update` mock's simulated running counter
// (see its comment below) -- reset in `beforeEach` so tests don't leak state.
let mockFailedLoginCounters: Record<string, number> | null = null;

// Mock the Prisma client before any imports that use it
const mockPrisma = {
  user: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    // TREQ-AUTH-007: recordFailedLogin() reads the post-write count off this
    // call's return value (an atomic `increment`, not a client-computed
    // literal -- see the service comment on why). The default implementation
    // mirrors real Postgres UPDATE ... SET x = x + 1 semantics: a per-user
    // running counter seeded from `findUnique`'s row on first use, then
    // incremented on every subsequent `update` call regardless of how many
    // requests are in flight concurrently -- exactly the guarantee that
    // makes the atomic form race-safe. (A version keyed off "whatever
    // findUnique last resolved" would collapse two concurrent increments
    // back into the same lost-update bug this mock exists to catch.)
    update: jest.fn(async (args: any) => {
      const inc = args?.data?.failed_login_count?.increment;
      if (typeof inc !== 'number') return {};
      const id = args.where.id;
      if (mockFailedLoginCounters === null) mockFailedLoginCounters = {};
      if (!(id in mockFailedLoginCounters)) {
        const seed: any = await (mockPrisma.user.findUnique as jest.Mock).mock.results[0]?.value;
        mockFailedLoginCounters[id] = seed?.failed_login_count ?? 0;
      }
      mockFailedLoginCounters[id] += inc;
      return { failed_login_count: mockFailedLoginCounters[id] };
    }) as jest.MockedFunction<(...args: any[]) => any>,
    // TREQ-AUTH-007: the admin-fallback recipient lookup when a failing
    // account has no responsible Regional Manager. Defaults to none so
    // suites that aren't about the escalation are unaffected.
    findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
  },
  // TREQ-AUTH-007: resolves the failing account's responsible manager
  // (EmploymentRecord -> HotelGroup -> regional_manager_user_id).
  employmentRecord: {
    findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
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
    updateMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  auditLog: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  notification: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  outboxEvent: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  // PR 5.4 (ADR-023 §6 / ADR-025 §4): AuthService.resolveScope reads these
  // read-only association tables when issuing an access token. Default to
  // "no association" (null) so existing tests that don't care about scope
  // are unaffected; dedicated coverage lives in auth-scope-claim.test.ts.
  hotelGroup: {
    // findFirst is what resolveScope() uses since 2026-09-02: the lookup
    // gained `deleted_at: null` so an ARCHIVED group cannot confer scope,
    // which makes the filter composite. Still a single-row read --
    // regional_manager_user_id is a unique FK (Regional Manager V1
    // Decision 1). findUnique stays mocked because other call sites in this
    // service still use it (e.g. the password-reset RM notification lookup).
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    // findUnique is still used by other lookups in this service (e.g. the
    // password-reset notification's RM resolution), so both stay mocked.
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotel: {
    // resolveScope() uses findMany + orderBy id as of 2026-08-07 (deterministic
    // scope for a manager assigned to multiple hotels). Defaults to [] --
    // these suites are not about scope resolution.
    findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
  },
  // Supports both the array form ($transaction([...])) and the callback
  // form ($transaction(async (tx) => ...)) used by ADR-031 PR-4's
  // transactional token_generation bumps — the callback receives mockPrisma
  // itself so tx.user.update etc. resolve against the same mocks.
  $transaction: jest.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => Promise<unknown>)(mockPrisma);
  }) as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({
  getPrisma: () => mockPrisma,
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-minimum-32-chars-x',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
    AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD: 5,
    AUTH_LOGIN_THROTTLE_THRESHOLD: 10,
    AUTH_LOGIN_THROTTLE_DURATION_MS: 900000,
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { AuthService } from '../modules/auth/service.js';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFailedLoginCounters = null;
    mockPrisma.notification.create.mockResolvedValue({ id: 'fake-notification-id' });
    mockPrisma.outboxEvent.create.mockResolvedValue({});
    service = new AuthService();
  });

  describe('signup', () => {
    it('throws ConflictError when email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'test@test.com' });

      await expect(
        service.signup({ email: 'test@test.com', password: 'password123', first_name: 'A', last_name: 'B' })
      ).rejects.toMatchObject({ name: 'ConflictError', message: 'Email already registered' });
    });

    it('creates user and returns tokens on success', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user_1',
        email: 'new@test.com',
        first_name: 'John',
        last_name: 'Doe',
        role: 'WORKER',
        is_active: true,
        created_at: new Date(),
      });
      mockPrisma.session.create.mockResolvedValue({ id: 'sess_1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.signup({
        email: 'new@test.com',
        password: 'password123',
        first_name: 'John',
        last_name: 'Doe',
      });

      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result.user.email).toBe('new@test.com');
      expect(result.user.role).toBe('worker');
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.session.create).toHaveBeenCalledTimes(1);
    });

    // ADR-031 D-1/M-3 (PR-7): permissions are no longer stored or written at
    // signup — the response body's `permissions` is derived from
    // ROLE_PERMISSIONS[role] after the row is created, so these assertions
    // now target the response, not the (removed) `data.permissions` write.
    it('assigns the non-privileged WORKER role and permissions on legitimate signup', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user_2', email: 'worker@test.com', first_name: 'Work', last_name: 'Er',
        role: 'WORKER', is_active: true, created_at: new Date(),
      });
      mockPrisma.session.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.signup({
        email: 'worker@test.com', password: 'password123', first_name: 'Work', last_name: 'Er',
      });

      const createCall = (mockPrisma.user.create as jest.Mock).mock.calls[0] as Array<{ data: { role: string } }>;
      expect(createCall[0]?.data.role).toBe('WORKER');
      expect(createCall[0]?.data).not.toHaveProperty('permissions');
      expect(result.user.permissions).not.toContain('admin:*');
      expect(result.user.permissions).toEqual(
        expect.arrayContaining(['hotels:read', 'rooms:read', 'tasks:read', 'notifications:read'])
      );
    });

    // HOTFIX-AUTH-001: privilege-escalation regression suite. The server must
    // never honour a client-supplied role on public signup — every injected
    // role must collapse to a non-privileged WORKER account.
    it.each([
      ['admin', 'admin:*'],
      ['manager', 'staffing:write'],
      ['checker', 'quality:write'],
      ['regional_manager', 'admin:*'],
    ])('ignores injected role "%s" and never grants privileged permissions', async (injectedRole: string, privilegedPerm: string) => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user_x', email: 'attacker@test.com', first_name: 'Mal', last_name: 'Ory',
        role: 'WORKER', is_active: true, created_at: new Date(),
      });
      mockPrisma.session.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.signup({
        email: 'attacker@test.com', password: 'password123', first_name: 'Mal', last_name: 'Ory',
        // Simulate an attacker bypassing the schema and injecting a privileged role.
        role: injectedRole,
      } as any);

      const createCall = (mockPrisma.user.create as jest.Mock).mock.calls[0] as Array<{ data: { role: string } }>;
      expect(createCall[0]?.data.role).toBe('WORKER');
      expect(createCall[0]?.data).not.toHaveProperty('permissions');
      expect(result.user.permissions).not.toContain(privilegedPerm);
      expect(result.user.permissions).not.toContain('admin:*');
    });
  });

  describe('login', () => {
    it('throws UnauthorizedError when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@test.com', password: 'pw' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
    });

    it('throws ForbiddenError when account is disabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'disabled@test.com',
        password_hash: '$2a$12$invalid',
        is_active: false,
        deleted_at: null,
        role: 'WORKER',
        permissions: [],
        failed_login_count: 0,
        failed_login_since: null,
      });

      await expect(
        service.login({ email: 'disabled@test.com', password: 'pw' })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('throws UnauthorizedError on wrong password', async () => {
      // bcrypt hash of "correctpassword"
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@test.com',
        password_hash: '$2a$12$notthehashofwrongpassword111111111111',
        is_active: true,
        deleted_at: null,
        role: 'WORKER',
        permissions: [],
        failed_login_count: 0,
        failed_login_since: null,
      });

      await expect(
        service.login({ email: 'user@test.com', password: 'wrongpassword' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
    });

    // SPEC-AUTH-001 TREQ-AUTH-007 / TRULE-AUTH-002 (2026-08-08): repeated
    // failed logins escalate by NOTIFYING the responsible manager -- this
    // half never locks the account or throttles further attempts. Before
    // this, a failed login produced no audit entry, no counter and no
    // notification at all. ADR-070 (2026-08-21) later added a SEPARATE,
    // higher threshold that DOES temporarily throttle (see the dedicated
    // 'per-account login throttle (ADR-070)' suite below) -- the two
    // thresholds are independent and this suite's assertions about the
    // notify threshold are unaffected by that addition.
    describe('failed-login monitoring (TREQ-AUTH-007)', () => {
      const failingUser = (overrides: Record<string, unknown> = {}) => ({
        id: 'u1',
        email: 'user@test.com',
        password_hash: '$2a$12$notthehashofwrongpassword111111111111',
        is_active: true,
        deleted_at: null,
        role: 'WORKER',
        permissions: [],
        failed_login_count: 0,
        failed_login_since: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
        token_generation: 0,
        ...overrides,
      });

      // Proves the fix for a race the original version of this code had: a
      // client-computed `failed_login_count: user.failed_login_count + 1`
      // loses an increment when two failed attempts overlap (both read the
      // same starting count, both write the same next value). An atomic
      // `{ increment: 1 }` cannot lose one -- each of N concurrent calls to
      // the mock above independently adds 1 on top of whatever the DB
      // already holds, the same guarantee Postgres's UPDATE ... SET
      // x = x + 1 gives under real concurrent transactions.
      it('does not lose an increment when two failed attempts race', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(failingUser({ failed_login_count: 0 }));

        const results = await Promise.all([
          service.login({ email: 'user@test.com', password: 'wrongpassword' }).catch((e) => e),
          service.login({ email: 'user@test.com', password: 'wrongpassword' }).catch((e) => e),
        ]);
        expect(results).toHaveLength(2);

        const counts = (
          await Promise.all(mockPrisma.user.update.mock.results.map((r: any) => r.value))
        ).map((v: any) => v?.failed_login_count);
        expect(counts.sort()).toEqual([1, 2]);
      });

      it('increments the consecutive-failure counter on a wrong password', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(failingUser({ failed_login_count: 2 }));

        await expect(
          service.login({ email: 'user@test.com', password: 'wrongpassword' })
        ).rejects.toMatchObject({ name: 'UnauthorizedError' });

        expect(mockPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'u1' },
            data: expect.objectContaining({ failed_login_count: { increment: 1 } }),
          })
        );
      });

      it('audits the failed attempt with the running count', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(failingUser({ failed_login_count: 1 }));

        await expect(
          service.login({ email: 'user@test.com', password: 'wrongpassword' })
        ).rejects.toMatchObject({ name: 'UnauthorizedError' });

        const audit = mockPrisma.auditLog.create.mock.calls.find(
          (c: any) => c[0].data.action === 'LOGIN_FAILED'
        );
        expect(audit).toBeDefined();
        expect(audit![0].data.details).toMatchObject({
          reason: 'invalid_password',
          consecutive_failures: 2,
        });
      });

      it('resets the counter on a successful login', async () => {
        const hash = await bcrypt.hash('correctpassword', 4);
        mockPrisma.user.findUnique.mockResolvedValue(
          failingUser({ password_hash: hash, failed_login_count: 3, failed_login_since: new Date() })
        );
        mockPrisma.session.create.mockResolvedValue({ id: 's1' });

        await service.login({ email: 'user@test.com', password: 'correctpassword' });

        expect(mockPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'u1' },
            // ADR-070: also clears login_locked_until, which this call now
            // always includes alongside the pre-existing counter reset.
            data: { failed_login_count: 0, failed_login_since: null, login_locked_until: null },
          })
        );
      });

      // 2026-08-13 fix (reported live: My Profile showed a green "Active"
      // badge for a still-Pending Manager). login()'s response seeds the
      // same client store the Profile page reads, so it must carry
      // employment_status too, not just getCurrentUser().
      it('includes employment_status from the EmploymentRecord in the login response', async () => {
        const hash = await bcrypt.hash('correctpassword', 4);
        mockPrisma.user.findUnique.mockResolvedValue(
          failingUser({ password_hash: hash, failed_login_count: 0 })
        );
        mockPrisma.session.create.mockResolvedValue({ id: 's1' });
        mockPrisma.employmentRecord.findUnique.mockResolvedValue({ status: 'PENDING' });

        const result = await service.login({ email: 'user@test.com', password: 'correctpassword' });

        expect(result.user.employment_status).toBe('PENDING');
      });

      it('reports employment_status null when no EmploymentRecord exists', async () => {
        const hash = await bcrypt.hash('correctpassword', 4);
        mockPrisma.user.findUnique.mockResolvedValue(
          failingUser({ password_hash: hash, failed_login_count: 0 })
        );
        mockPrisma.session.create.mockResolvedValue({ id: 's1' });
        mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);

        const result = await service.login({ email: 'user@test.com', password: 'correctpassword' });

        expect(result.user.employment_status).toBeNull();
      });

      it('issues no counter write on a successful login when the streak is already zero', async () => {
        const hash = await bcrypt.hash('correctpassword', 4);
        mockPrisma.user.findUnique.mockResolvedValue(
          failingUser({ password_hash: hash, failed_login_count: 0 })
        );
        mockPrisma.session.create.mockResolvedValue({ id: 's1' });

        await service.login({ email: 'user@test.com', password: 'correctpassword' });

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      });

      it('notifies the responsible Regional Manager exactly when the threshold is crossed', async () => {
        // 4 -> 5 with a threshold of 5.
        mockPrisma.user.findUnique.mockResolvedValue(failingUser({ failed_login_count: 4 }));
        mockPrisma.employmentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        mockPrisma.hotelGroup.findUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });
        mockPrisma.notification.create.mockResolvedValue({ id: 'n1' });
        mockPrisma.outboxEvent.create.mockResolvedValue({ id: 'o1' });

        await expect(
          service.login({ email: 'user@test.com', password: 'wrongpassword' })
        ).rejects.toMatchObject({ name: 'UnauthorizedError' });

        expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
        const notif = mockPrisma.notification.create.mock.calls[0][0].data;
        expect(notif.user_id).toBe('rm1');
        expect(notif.type).toBe('REPEATED_FAILED_LOGINS');
      });

      it('does not notify below the threshold', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(failingUser({ failed_login_count: 3 }));

        await expect(
          service.login({ email: 'user@test.com', password: 'wrongpassword' })
        ).rejects.toMatchObject({ name: 'UnauthorizedError' });

        expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      });

      // Fires at `=== threshold`, not `>=`: a sustained attack should raise
      // one alert per streak, not one per attempt after the fifth.
      it('does not re-notify on every attempt once past the threshold', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(failingUser({ failed_login_count: 9 }));

        await expect(
          service.login({ email: 'user@test.com', password: 'wrongpassword' })
        ).rejects.toMatchObject({ name: 'UnauthorizedError' });

        expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      });

      it('falls back to admins when the failing account has no responsible Regional Manager', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(failingUser({ failed_login_count: 4 }));
        mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);
        mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin1' }, { id: 'admin2' }]);
        mockPrisma.notification.create.mockResolvedValue({ id: 'n1' });
        mockPrisma.outboxEvent.create.mockResolvedValue({ id: 'o1' });

        await expect(
          service.login({ email: 'user@test.com', password: 'wrongpassword' })
        ).rejects.toMatchObject({ name: 'UnauthorizedError' });

        const recipients = mockPrisma.notification.create.mock.calls.map((c: any) => c[0].data.user_id);
        expect(recipients).toEqual(['admin1', 'admin2']);
      });

      it('never notifies the account holder about their own failed logins', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(failingUser({ failed_login_count: 4 }));
        mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);
        // The only admin IS the account being attacked.
        mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);

        await expect(
          service.login({ email: 'user@test.com', password: 'wrongpassword' })
        ).rejects.toMatchObject({ name: 'UnauthorizedError' });

        expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      });

      it('records a failed attempt against a DISABLED account too', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(
          failingUser({ is_active: false, failed_login_count: 1 })
        );

        await expect(
          service.login({ email: 'user@test.com', password: 'pw' })
        ).rejects.toMatchObject({ name: 'ForbiddenError' });

        const audit = mockPrisma.auditLog.create.mock.calls.find(
          (c: any) => c[0].data.action === 'LOGIN_FAILED'
        );
        expect(audit![0].data.details).toMatchObject({ reason: 'account_disabled' });
      });

      // The monitoring must not become an account-existence oracle: an
      // unknown email and a wrong password must be indistinguishable to the
      // caller. (A disabled account is a deliberate, specified exception --
      // REQ-AUTH-003 mandates its distinct 403, and its own test above
      // asserts that contract.)
      it('does not leak account existence: unknown email and wrong password return identical errors', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        const unknown = await service
          .login({ email: 'nobody@test.com', password: 'pw' })
          .catch((e) => e);

        mockPrisma.user.findUnique.mockResolvedValue(failingUser());
        const wrongPw = await service
          .login({ email: 'user@test.com', password: 'wrongpassword' })
          .catch((e) => e);

        expect(unknown.name).toBe(wrongPw.name);
        expect(unknown.message).toBe(wrongPw.message);
        expect(unknown.statusCode).toBe(wrongPw.statusCode);
      });

      it('audits an unknown-email attempt with a null actor and no counter write', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expect(
          service.login({ email: 'nobody@test.com', password: 'pw' })
        ).rejects.toMatchObject({ name: 'UnauthorizedError' });

        const audit = mockPrisma.auditLog.create.mock.calls.find(
          (c: any) => c[0].data.action === 'LOGIN_FAILED'
        );
        expect(audit).toBeDefined();
        expect(audit![0].data.actor_id).toBeNull();
        expect(audit![0].data.details).toMatchObject({ reason: 'user_not_found' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      });
    });

    // ADR-070 (2026-08-21): per-account throttle, distinct from and above
    // TREQ-AUTH-007's notify threshold (5) -- see that ADR for why this is
    // bounded throttling, not the lockout TREQ-AUTH-007 rules out.
    describe('per-account login throttle (ADR-070)', () => {
      const throttleUser = (overrides: Record<string, unknown> = {}) => ({
        id: 'u1',
        email: 'user@test.com',
        password_hash: '$2a$12$notthehashofwrongpassword111111111111',
        is_active: true,
        deleted_at: null,
        role: 'WORKER',
        permissions: [],
        failed_login_count: 0,
        failed_login_since: null,
        login_locked_until: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
        token_generation: 0,
        ...overrides,
      });

      it('sets login_locked_until on the attempt that crosses the throttle threshold (10), not before', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(throttleUser({ failed_login_count: 9 }));

        await expect(
          service.login({ email: 'user@test.com', password: 'wrongpassword' })
        ).rejects.toMatchObject({ name: 'UnauthorizedError' });

        expect(mockPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'u1' },
            data: expect.objectContaining({ login_locked_until: expect.any(Date) }),
          })
        );
      });

      it('does not set login_locked_until below the threshold', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(throttleUser({ failed_login_count: 6 }));

        await expect(
          service.login({ email: 'user@test.com', password: 'wrongpassword' })
        ).rejects.toMatchObject({ name: 'UnauthorizedError' });

        const lockCalls = mockPrisma.user.update.mock.calls.filter(
          (c: any) => c[0]?.data && 'login_locked_until' in c[0].data
        );
        expect(lockCalls).toHaveLength(0);
      });

      it('rejects with TooManyRequestsError while login_locked_until is in the future, without checking the password', async () => {
        const compareSpy = jest.spyOn(bcrypt, 'compare');
        mockPrisma.user.findUnique.mockResolvedValue(
          throttleUser({ login_locked_until: new Date(Date.now() + 60_000) })
        );

        await expect(
          service.login({ email: 'user@test.com', password: 'anything' })
        ).rejects.toMatchObject({ name: 'TooManyRequestsError', statusCode: 429 });

        expect(compareSpy).not.toHaveBeenCalled();
        compareSpy.mockRestore();
      });

      it('computes a positive Retry-After from the remaining window', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(
          throttleUser({ login_locked_until: new Date(Date.now() + 120_000) })
        );

        const error = await service
          .login({ email: 'user@test.com', password: 'anything' })
          .catch((e) => e);

        expect(error.retryAfterSeconds).toBeGreaterThan(0);
        expect(error.retryAfterSeconds).toBeLessThanOrEqual(120);
      });

      // A lock with well under a second left still yields a whole, positive
      // Retry-After rather than 0.
      //
      // Previously this set the lock 1ms in the future, which made the test
      // flaky: the entry check is `login_locked_until > new Date()`, so any
      // scheduling delay over 1ms let the lock expire before the service read
      // it, login fell through to the wrong-password path, and the assertion
      // saw UnauthorizedError. It failed intermittently in CI under load.
      //
      // 900ms is comfortably inside the lock while still sub-second, so
      // Math.ceil is what has to round it up to 1.
      it('never returns a zero or negative Retry-After for an almost-expired lock', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(
          throttleUser({ login_locked_until: new Date(Date.now() + 900) })
        );

        const error = await service
          .login({ email: 'user@test.com', password: 'anything' })
          .catch((e) => e);

        expect(error.name).toBe('TooManyRequestsError');
        expect(error.retryAfterSeconds).toBe(1);
        expect(Number.isInteger(error.retryAfterSeconds)).toBe(true);
      });

      // The `Math.max(1, ...)` clamp itself, deterministically.
      //
      // The clamp only matters when the delta is <= 0, which happens when the
      // lock expires BETWEEN the entry check (`new Date()`) and the
      // computation (`Date.now()`) — microseconds apart, and not reproducible
      // by waiting. The old test tried to approach that window with a 1ms lock
      // and only bought flakiness: Math.ceil already returns >= 1 for any
      // positive delta, so it never reached the clamp at all.
      //
      // Stubbing Date.now alone splits the two reads: `new Date()` still sees
      // real time, so the entry check passes, while the computation sees a
      // moment after the lock expired and subtracts to a negative.
      it('clamps to 1 when the lock expires between the two clock reads', async () => {
        const lockedUntil = new Date(Date.now() + 1000);
        mockPrisma.user.findUnique.mockResolvedValue(
          throttleUser({ login_locked_until: lockedUntil })
        );

        const realNow = Date.now;
        // Well past the lock, so the raw computation is negative.
        Date.now = () => lockedUntil.getTime() + 5000;
        try {
          const error = await service
            .login({ email: 'user@test.com', password: 'anything' })
            .catch((e) => e);

          expect(error.name).toBe('TooManyRequestsError');
          // Without the clamp this would be -5 (Math.ceil(-5000 / 1000)).
          expect(error.retryAfterSeconds).toBe(1);
        } finally {
          Date.now = realNow;
        }
      });

      it('allows login once login_locked_until has passed', async () => {
        const hash = await bcrypt.hash('correctpassword', 4);
        mockPrisma.user.findUnique.mockResolvedValue(
          throttleUser({
            password_hash: hash,
            failed_login_count: 10,
            login_locked_until: new Date(Date.now() - 1000), // already expired
          })
        );
        mockPrisma.session.create.mockResolvedValue({ id: 's1' });

        await expect(
          service.login({ email: 'user@test.com', password: 'correctpassword' })
        ).resolves.toMatchObject({ user: expect.objectContaining({ id: 'u1' }) });
      });

      it('clears login_locked_until alongside the counter on a successful login', async () => {
        const hash = await bcrypt.hash('correctpassword', 4);
        mockPrisma.user.findUnique.mockResolvedValue(
          throttleUser({
            password_hash: hash,
            failed_login_count: 10,
            login_locked_until: new Date(Date.now() - 1000),
          })
        );
        mockPrisma.session.create.mockResolvedValue({ id: 's1' });

        await service.login({ email: 'user@test.com', password: 'correctpassword' });

        expect(mockPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'u1' },
            data: { failed_login_count: 0, failed_login_since: null, login_locked_until: null },
          })
        );
      });

      it('does not record a failed-login attempt while throttled (the streak is not re-inflated)', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(
          throttleUser({ login_locked_until: new Date(Date.now() + 60_000) })
        );

        await expect(
          service.login({ email: 'user@test.com', password: 'anything' })
        ).rejects.toMatchObject({ name: 'TooManyRequestsError' });

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('logout', () => {
    it('deletes all sessions when no refresh token provided', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.logout('user_1');

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { user_id: 'user_1' },
      });
    });

    it('deletes specific session when refresh token provided (looked up by hash, not raw value)', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.logout('user_1', 'specific-refresh-token');

      const expectedHash = crypto.createHash('sha256').update('specific-refresh-token').digest('hex');
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { user_id: 'user_1', refresh_token: expectedHash },
      });
    });
  });

  // ADR-031 D-4: Admin-only "log out everywhere" — deliberately does NOT
  // touch Session rows (that's logout's job); it only bumps token_generation
  // so already-issued access tokens stop authorizing.
  describe('revokeAllSessions', () => {
    it('bumps token_generation and does not delete any sessions', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', deleted_at: null });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.revokeAllSessions('user_1', 'admin_actor', 'admin');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: { token_generation: { increment: 1 } },
      });
      expect(mockPrisma.session.deleteMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundError for a soft-deleted or missing user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeAllSessions('missing_user', 'admin_actor', 'admin')
      ).rejects.toMatchObject({ name: 'NotFoundError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentUser', () => {
    it('returns user when found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'user@test.com',
        first_name: 'John',
        last_name: 'Doe',
        phone: null,
        profile_photo_url: null,
        role: 'WORKER',
        permissions: [],
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.getCurrentUser('user_1');

      expect(result.id).toBe('user_1');
      expect(result.role).toBe('worker');
      // Not selected by this mock -> employment_record is undefined ->
      // must fall back to null, never crash on the optional chain.
      expect(result.employment_status).toBeNull();
    });

    // Reported live: "workers cannot see their profile photos in the apps".
    // login() carried has_profile_photo, so the avatar appeared immediately
    // after signing in -- but every app launch restores the session through
    // THIS endpoint (each app's auth-store initialize()), and it returned the
    // raw profile_photo_key spread straight through `...rest` and no flag at
    // all. So the photo showed once and was replaced by initials on the next
    // launch. The key must also never leave the process: it is an internal
    // storage detail, and this is the most-called endpoint in the platform.
    it('reports has_profile_photo and never returns the raw storage key', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'user@test.com',
        first_name: 'John',
        last_name: 'Doe',
        phone: null,
        profile_photo_key: 'profile-photos/user_1/uuid/photo.jpg',
        role: 'WORKER',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.getCurrentUser('user_1');

      expect(result.has_profile_photo).toBe(true);
      expect(result).not.toHaveProperty('profile_photo_key');
      expect(JSON.stringify(result)).not.toContain('profile-photos/');
    });

    it('reports has_profile_photo false when the account has no photo', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'user@test.com',
        first_name: 'John',
        last_name: 'Doe',
        phone: null,
        profile_photo_key: null,
        role: 'WORKER',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.getCurrentUser('user_1');

      expect(result.has_profile_photo).toBe(false);
    });

    // 2026-08-13 fix (reported live): this endpoint is /auth/me, which My
    // Profile and SessionBootstrap read the signed-in user from. It never
    // selected the EmploymentRecord, so a still-onboarding user's own
    // profile fell back to the account `is_active` flag (true from
    // creation) and showed a green "Active" badge for someone who had not
    // been approved at all.
    it('reports the EmploymentRecord status, not the account is_active flag', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_2',
        email: 'pending@test.com',
        first_name: 'Pend',
        last_name: 'Ing',
        phone: null,
        profile_photo_url: null,
        role: 'MANAGER',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        employment_record: { status: 'PENDING' },
      });

      const result = await service.getCurrentUser('user_2');

      expect(result.employment_status).toBe('PENDING');
      expect(result.is_active).toBe(true);
    });

    it('reports employment_status null for an account with no EmploymentRecord (e.g. admin)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin_1',
        email: 'admin@test.com',
        first_name: 'Ad',
        last_name: 'Min',
        phone: null,
        profile_photo_url: null,
        role: 'ADMIN',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        employment_record: null,
      });

      const result = await service.getCurrentUser('admin_1');

      expect(result.employment_status).toBeNull();
    });

    it('throws NotFoundError when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getCurrentUser('nonexistent')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });
  });

  // HOTFIX-AUTH-002: the previous single-step `resetPassword(email, new_password)`
  // let anyone who knew a victim's email overwrite their password with no proof
  // of account ownership. This regression suite covers the replacement two-step,
  // server-issued single-use token flow (request -> confirm).
  describe('requestPasswordReset', () => {
    const activeUser = {
      id: 'user_1',
      email: 'victim@test.com',
      role: 'WORKER',
      is_active: true,
      deleted_at: null,
    };

    it('silently succeeds for an unknown email (no account enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.requestPasswordReset({ email: 'nobody@test.com' })
      ).resolves.toBeUndefined();
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('silently succeeds without issuing a token for a disabled account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, is_active: false });

      await service.requestPasswordReset({ email: activeUser.email });
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('silently succeeds without issuing a token for a soft-deleted account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, deleted_at: new Date() });

      await service.requestPasswordReset({ email: activeUser.email });
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('invalidates any prior outstanding tokens before issuing a new one', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.requestPasswordReset({ email: activeUser.email });

      expect(mockPrisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { user_id: activeUser.id, used_at: null },
      });
      const deleteOrder = (mockPrisma.passwordResetToken.deleteMany as jest.Mock).mock.invocationCallOrder[0];
      const createOrder = (mockPrisma.passwordResetToken.create as jest.Mock).mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(createOrder);
    });

    it('creates a hashed, expiring, single-use token for a known active user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.requestPasswordReset({ email: activeUser.email }, '127.0.0.1');

      expect(mockPrisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const createCall = (mockPrisma.passwordResetToken.create as jest.Mock).mock.calls[0] as Array<{
        data: { user_id: string; token_hash: string; expires_at: Date };
      }>;
      expect(createCall[0]?.data.user_id).toBe(activeUser.id);
      // The raw token is never persisted — only a hash, and it must not be a
      // trivially-guessable/short value.
      expect(createCall[0]?.data.token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(createCall[0]?.data.expires_at.getTime()).toBeGreaterThan(Date.now());
    });

    it('never overwrites password_hash directly, even if new_password is injected into the request', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.passwordResetToken.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      // Simulate an attacker bypassing the schema (which no longer declares
      // new_password on the request step) and injecting it directly.
      await service.requestPasswordReset({
        email: activeUser.email,
        new_password: 'Attacker123',
      } as any);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.session.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('confirmPasswordReset', () => {
    const activeUser = {
      id: 'user_1',
      email: 'victim@test.com',
      role: 'WORKER',
      is_active: true,
      deleted_at: null,
    };
    const validRawToken = 'a'.repeat(64);
    const validTokenRecord = {
      id: 'prt_1',
      user_id: activeUser.id,
      token_hash: require('node:crypto').createHash('sha256').update(validRawToken).digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
      used_at: null,
    };

    it('performs a valid password reset and invalidates all sessions', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRecord);
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.passwordResetToken.update.mockResolvedValue({});
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.confirmPasswordReset({ token: validRawToken, new_password: 'NewPassw0rd' });

      // Check token used
      expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: validTokenRecord.id, used_at: null }, })
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: activeUser.id } })
      );
      expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: validTokenRecord.id, used_at: null }, data: expect.objectContaining({ used_at: expect.any(Date) }) })
      );
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { user_id: activeUser.id } });
    });

    // ADR-031 D-4: post-compromise lockout extends to already-issued access
    // tokens, not just Session rows, and commits in the same transaction.
    it('bumps token_generation in the same transaction as the reset', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRecord);
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.confirmPasswordReset({ token: validRawToken, new_password: 'NewPassw0rd' });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: activeUser.id }, data: { token_generation: { increment: 1 } } })
      );
    });

    it('rejects a random/forged token that was never issued', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmPasswordReset({ token: 'totally-forged-random-token', new_password: 'NewPassw0rd' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an expired token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        ...validTokenRecord,
        expires_at: new Date(Date.now() - 60 * 1000),
      });

      await expect(
        service.confirmPasswordReset({ token: validRawToken, new_password: 'NewPassw0rd' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a reused token (token replay)', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        ...validTokenRecord,
        used_at: new Date(),
      });

      await expect(
        service.confirmPasswordReset({ token: validRawToken, new_password: 'NewPassw0rd' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a token belonging to a deleted or deactivated account', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(validTokenRecord);
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, is_active: false });

      await expect(
        service.confirmPasswordReset({ token: validRawToken, new_password: 'NewPassw0rd' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an unauthorized reset attempt with no valid token in the system', async () => {
      // No request step was ever performed for this user (no token was ever
      // issued) -- the original vulnerability let anyone reset a password by
      // email alone; confirming now unconditionally requires a real token.
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmPasswordReset({ token: 'guess', new_password: 'NewPassw0rd' })
      ).rejects.toMatchObject({ name: 'UnauthorizedError' });
    });
  });
});

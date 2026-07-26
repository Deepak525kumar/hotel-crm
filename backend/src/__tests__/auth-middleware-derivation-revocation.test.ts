import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * ADR-031 §7 PR-3 — "The cutover."
 *
 * authMiddleware/optionalAuthMiddleware gain a live User-row read behind two
 * independent flags: FEATURE_DERIVED_PERMISSIONS (permissions come from
 * ROLE_PERMISSIONS[row.role], not the JWT claim) and
 * FEATURE_TOKEN_GENERATION_ENFORCEMENT (a token_generation mismatch is a 401
 * TOKEN_REVOKED). Both-off must reproduce today's behavior exactly (ADR-031
 * C-4) — the sibling suites (auth.test.ts, auth-scope-authz.test.ts, etc.)
 * already cover that path with the flags at their real (false) default and
 * must keep passing unmodified; this suite exercises the flags themselves.
 */

const mockUserFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    user: { findUnique: mockUserFindUnique },
  }),
}));

let derivedEnabled = false;
let enforcementEnabled = false;

jest.mock('../config/feature-flags.js', () => ({
  isDerivedPermissionsEnabled: () => derivedEnabled,
  isTokenGenerationEnforcementEnabled: () => enforcementEnabled,
}));

const mockVerifyAccessToken = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/jwt.js', () => ({
  extractTokenFromHeader: (header: string | undefined) =>
    header?.startsWith('Bearer ') ? header.slice(7) : null,
  verifyAccessToken: (token: string) => mockVerifyAccessToken(token),
}));

import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { ERROR_CODES } from '../config/constants.js';

function makeReq(token: string | undefined) {
  return { headers: { authorization: token ? `Bearer ${token}` : undefined }, auth: undefined } as any;
}

describe('ADR-031 PR-3 — authMiddleware / optionalAuthMiddleware cutover', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockVerifyAccessToken.mockReset();
    derivedEnabled = false;
    enforcementEnabled = false;
  });

  // ADR-031 PR-5: the `permissions` claim no longer exists on the token —
  // this fixture omits it entirely, matching a real post-PR-5 payload.
  const basePayload = {
    sub: 'user-1',
    email: 'a@b.com',
    role: 'manager',
    scope: null,
    token_generation: 3,
  };

  describe('both flags off (C-4: today\'s behavior, byte-for-byte)', () => {
    it('never reads the database, and grants no permissions since the claim no longer exists (PR-5)', async () => {
      mockVerifyAccessToken.mockReturnValue(basePayload);
      const req = makeReq('tok');
      const next = jest.fn();

      await authMiddleware(req, {} as any, next);

      expect(mockUserFindUnique).not.toHaveBeenCalled();
      expect(req.auth).toEqual({
        userId: 'user-1',
        email: 'a@b.com',
        role: 'manager',
        permissions: [],
        scope: null,
      });
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('FEATURE_TOKEN_GENERATION_ENFORCEMENT on', () => {
    beforeEach(() => {
      enforcementEnabled = true;
    });

    it('401 UNAUTHORIZED when the account is inactive', async () => {
      mockVerifyAccessToken.mockReturnValue(basePayload);
      mockUserFindUnique.mockResolvedValue({
        id: 'user-1', role: 'MANAGER', is_active: false, deleted_at: null, token_generation: 3,
      });
      const req = makeReq('tok');
      const next = jest.fn();

      await authMiddleware(req, {} as any, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: ERROR_CODES.UNAUTHORIZED }));
      expect(req.auth).toBeUndefined();
    });

    it('401 UNAUTHORIZED when the account is soft-deleted', async () => {
      mockVerifyAccessToken.mockReturnValue(basePayload);
      mockUserFindUnique.mockResolvedValue({
        id: 'user-1', role: 'MANAGER', is_active: true, deleted_at: new Date(), token_generation: 3,
      });
      const req = makeReq('tok');
      const next = jest.fn();

      await authMiddleware(req, {} as any, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: ERROR_CODES.UNAUTHORIZED }));
    });

    it('401 TOKEN_REVOKED when the claim generation does not match the row', async () => {
      mockVerifyAccessToken.mockReturnValue(basePayload); // token_generation: 3
      mockUserFindUnique.mockResolvedValue({
        id: 'user-1', role: 'MANAGER', is_active: true, deleted_at: null, token_generation: 4,
      });
      const req = makeReq('tok');
      const next = jest.fn();

      await authMiddleware(req, {} as any, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: ERROR_CODES.TOKEN_REVOKED }));
    });

    // ADR-031 D-3.2/PR-5: a claim-less token (issued before PR-2, or after
    // PR-5 dropped the claim's issuance guarantee entirely) is now REJECTED
    // outright rather than coerced to generation 0 — the one intentional
    // forced-re-auth event this record accepts (§8). This replaces the
    // pre-PR-5 permissive "generation 0 passes" behavior.
    it('D-3.2/PR-5: a token with no token_generation claim is rejected even against a row still at generation 0', async () => {
      const { token_generation: _omit, ...payloadWithoutClaim } = basePayload;
      mockVerifyAccessToken.mockReturnValue(payloadWithoutClaim);
      mockUserFindUnique.mockResolvedValue({
        id: 'user-1', role: 'MANAGER', is_active: true, deleted_at: null, token_generation: 0,
      });
      const req = makeReq('tok');
      const next = jest.fn();

      await authMiddleware(req, {} as any, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: ERROR_CODES.TOKEN_REVOKED }));
      expect(req.auth).toBeUndefined();
    });

    it('D-3.2/PR-5: a claim-less token is REJECTED against a row that has since been bumped off 0', async () => {
      const { token_generation: _omit, ...payloadWithoutClaim } = basePayload;
      mockVerifyAccessToken.mockReturnValue(payloadWithoutClaim);
      mockUserFindUnique.mockResolvedValue({
        id: 'user-1', role: 'MANAGER', is_active: true, deleted_at: null, token_generation: 1,
      });
      const req = makeReq('tok');
      const next = jest.fn();

      await authMiddleware(req, {} as any, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: ERROR_CODES.TOKEN_REVOKED }));
    });

    it('passes through when generations match, with no permissions claim to fall back on', async () => {
      mockVerifyAccessToken.mockReturnValue(basePayload);
      mockUserFindUnique.mockResolvedValue({
        id: 'user-1', role: 'MANAGER', is_active: true, deleted_at: null, token_generation: 3,
      });
      const req = makeReq('tok');
      const next = jest.fn();

      await authMiddleware(req, {} as any, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.auth?.permissions).toEqual([]); // derivation off, no claim to fall back on (PR-5)
    });
  });

  describe('FEATURE_DERIVED_PERMISSIONS on', () => {
    beforeEach(() => {
      derivedEnabled = true;
    });

    it('derives permissions from ROLE_PERMISSIONS[row.role], not the claim', async () => {
      mockVerifyAccessToken.mockReturnValue({ ...basePayload, permissions: ['stale:claim'] });
      mockUserFindUnique.mockResolvedValue({
        id: 'user-1', role: 'WORKER', is_active: true, deleted_at: null, token_generation: 3,
      });
      const req = makeReq('tok');
      const next = jest.fn();

      await authMiddleware(req, {} as any, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.auth?.permissions).not.toEqual(['stale:claim']);
      expect(req.auth?.role).toBe('worker');
    });

    it('a demotion takes effect immediately (row role wins over claim role)', async () => {
      mockVerifyAccessToken.mockReturnValue({ ...basePayload, role: 'manager' });
      mockUserFindUnique.mockResolvedValue({
        id: 'user-1', role: 'WORKER', is_active: true, deleted_at: null, token_generation: 3,
      });
      const req = makeReq('tok');
      const next = jest.fn();

      await authMiddleware(req, {} as any, next);

      expect(req.auth?.role).toBe('worker');
    });
  });

  describe('optionalAuthMiddleware — C-3 identical treatment', () => {
    it('leaves req.auth unset (never partially populated) when revoked', async () => {
      enforcementEnabled = true;
      mockVerifyAccessToken.mockReturnValue(basePayload);
      mockUserFindUnique.mockResolvedValue({
        id: 'user-1', role: 'MANAGER', is_active: true, deleted_at: null, token_generation: 99,
      });
      const req = makeReq('tok');
      const next = jest.fn();

      await optionalAuthMiddleware(req, {} as any, next);

      expect(req.auth).toBeUndefined();
      expect(next).toHaveBeenCalledWith(); // optional auth never fails the request
    });

    it('populates req.auth when the account is valid and flags are off', async () => {
      mockVerifyAccessToken.mockReturnValue(basePayload);
      const req = makeReq('tok');
      const next = jest.fn();

      await optionalAuthMiddleware(req, {} as any, next);

      expect(mockUserFindUnique).not.toHaveBeenCalled();
      expect(req.auth).toBeDefined();
      expect(next).toHaveBeenCalledWith();
    });

    it('no token at all: req.auth stays unset, no DB read, next() still called', async () => {
      const req = makeReq(undefined);
      const next = jest.fn();

      await optionalAuthMiddleware(req, {} as any, next);

      expect(mockUserFindUnique).not.toHaveBeenCalled();
      expect(req.auth).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
    });
  });
});

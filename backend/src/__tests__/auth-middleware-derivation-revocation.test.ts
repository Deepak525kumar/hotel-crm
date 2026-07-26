import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * ADR-031 §7 PR-7 — flag retirement.
 *
 * authMiddleware/optionalAuthMiddleware's live User-row read (D-3), request-
 * time permission derivation (D-1), and token_generation revocation check
 * (D-3.2/D-4) are unconditional as of PR-7 — FEATURE_DERIVED_PERMISSIONS and
 * FEATURE_TOKEN_GENERATION_ENFORCEMENT are retired. This suite replaces the
 * PR-3-era flag-matrix suite: every scenario below is the platform's only
 * behavior now, not one of four flag combinations.
 */

const mockUserFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    user: { findUnique: mockUserFindUnique },
  }),
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

describe('ADR-031 PR-7 — authMiddleware / optionalAuthMiddleware (unconditional derivation + revocation)', () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockVerifyAccessToken.mockReset();
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

  // ADR-031 D-3.2: a claim-less token (issued before PR-2, or any token
  // whose claim is otherwise absent) is REJECTED outright, never coerced to
  // generation 0 — the one intentional forced-re-auth event this record
  // accepts (§8).
  it('D-3.2: a token with no token_generation claim is rejected even against a row still at generation 0', async () => {
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

  it('D-3.2: a claim-less token is REJECTED against a row that has since been bumped off 0', async () => {
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

  it('passes through when generations match, deriving permissions from ROLE_PERMISSIONS[row.role]', async () => {
    mockVerifyAccessToken.mockReturnValue(basePayload);
    mockUserFindUnique.mockResolvedValue({
      id: 'user-1', role: 'MANAGER', is_active: true, deleted_at: null, token_generation: 3,
    });
    const req = makeReq('tok');
    const next = jest.fn();

    await authMiddleware(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.auth?.role).toBe('manager');
    expect(req.auth?.permissions.length).toBeGreaterThan(0);
  });

  it('derives permissions from ROLE_PERMISSIONS[row.role], ignoring any stray claim field', async () => {
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

  describe('optionalAuthMiddleware — C-3 identical treatment', () => {
    it('leaves req.auth unset (never partially populated) when revoked', async () => {
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

    it('populates req.auth when the account is valid', async () => {
      mockVerifyAccessToken.mockReturnValue(basePayload);
      mockUserFindUnique.mockResolvedValue({
        id: 'user-1', role: 'MANAGER', is_active: true, deleted_at: null, token_generation: 3,
      });
      const req = makeReq('tok');
      const next = jest.fn();

      await optionalAuthMiddleware(req, {} as any, next);

      expect(req.auth).toBeDefined();
      expect(req.auth.role).toBe('manager');
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

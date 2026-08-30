import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Authorization for inspection evidence.
//
// The route is gated `quality:read`, which is NOT sufficient on its own:
// ADR-067 granted WORKER that token so a worker can see their own hotel
// group's leaderboard. Gating on the permission alone would let any worker
// read any other worker's room evidence by id -- an IDOR on
// special-category-adjacent data. Hence deny-by-default in the service.

jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockInScope = jest.fn() as jest.MockedFunction<(...a: unknown[]) => Promise<boolean>>;
jest.mock('../middleware/permissions.js', () => ({
  isHotelInScope: (...a: unknown[]) => mockInScope(...a),
}));

const mockGetPresignedUrl = jest.fn() as jest.MockedFunction<(k: string) => Promise<string | null>>;
jest.mock('../modules/documents/storage.js', () => ({
  getStorageClient: async () => ({
    getPresignedUrl: (k: string) => mockGetPresignedUrl(k),
    upload: jest.fn(),
    delete: jest.fn(),
  }),
  generateQualityPhotoKey: () => 'quality/a/inspection/u/p.jpg',
}));

const mockFindUnique = jest.fn() as jest.MockedFunction<(...a: unknown[]) => any>;
const mockCheckerAssignment = jest.fn() as jest.MockedFunction<(...a: unknown[]) => any>;

import { QualityService } from '../modules/quality/service.js';

const VERIFICATION = {
  id: 'v1',
  hotel_id: 'h1',
  photo_urls: ['quality/a1/inspection/u/p.jpg'],
  // Rounds carry the worker's evidence separately from the checker's own
  // photographs (2026-08-30); a check with none renders no round sections.
  rework_rounds: [],
  assignment: { worker_id: 'subject-worker' },
};

function svc() {
  const s = new QualityService();
  // The service reads through this.prisma; point it at the mock.
  (s as unknown as { prisma: unknown }).prisma = {
    qualityVerification: { findUnique: (...a: unknown[]) => mockFindUnique(...a) },
    // 2026-08-24: the checker branch no longer resolves through JWT scope
    // (a checker never receives one) — it asks whether the checker has an
    // active assignment at that hotel, the same rule createVerification uses.
    workerAssignment: { findFirst: (...a: unknown[]) => mockCheckerAssignment(...a) },
  };
  return s;
}

const actor = (role: string, userId = 'someone') => ({ userId, role, scope: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockFindUnique.mockResolvedValue(VERIFICATION);
  mockGetPresignedUrl.mockResolvedValue('https://signed.example/p.jpg');
  mockInScope.mockResolvedValue(true);
  mockCheckerAssignment.mockResolvedValue({ id: 'chk-assignment' });
});

describe('getVerificationPhotos — who may see room evidence', () => {
  it('admits the worker the inspection is ABOUT', async () => {
    const r = await svc().getVerificationPhotos('v1', actor('worker', 'subject-worker'));
    expect(r.photos[0].url).toBe('https://signed.example/p.jpg');
  });

  it('REFUSES a different worker — the IDOR this guards', async () => {
    // A worker holds quality:read, so the route lets them in; only this check
    // stops them reading a colleague's evidence.
    await expect(
      svc().getVerificationPhotos('v1', actor('worker', 'other-worker'))
    ).rejects.toThrow(/Cannot view evidence/);
  });

  it('admits an admin unscoped', async () => {
    const r = await svc().getVerificationPhotos('v1', actor('admin'));
    expect(r.photos).toHaveLength(1);
    expect(mockInScope).not.toHaveBeenCalled();
  });

  it.each(['manager', 'regional_manager'])(
    'admits %s only for a hotel in their scope',
    async (role) => {
      await svc().getVerificationPhotos('v1', actor(role));
      expect(mockInScope).toHaveBeenCalled();
    }
  );

  it.each(['manager', 'regional_manager'])(
    'REFUSES %s for a hotel outside their scope',
    async (role) => {
      mockInScope.mockResolvedValue(false);
      await expect(svc().getVerificationPhotos('v1', actor(role))).rejects.toThrow(
        /Cannot view evidence for this hotel/
      );
    }
  );

  // Checker is gated on its assignment, NOT on JWT scope — regression guard
  // for the 2026-08-24 defect where a checker could never read evidence,
  // including photos it had just uploaded, because resolveScope() never mints
  // a scope for the checker role and isHotelInScope(null, …) always denies.
  it('admits a checker with an active assignment at that hotel, WITHOUT any JWT scope', async () => {
    const r = await svc().getVerificationPhotos('v1', actor('checker'));
    expect(r.photos).toHaveLength(1);
    expect(mockCheckerAssignment).toHaveBeenCalled();
    expect(mockInScope).not.toHaveBeenCalled();
  });

  it('REFUSES a checker with no active assignment at that hotel', async () => {
    mockCheckerAssignment.mockResolvedValue(null);
    await expect(svc().getVerificationPhotos('v1', actor('checker'))).rejects.toThrow(
      /Cannot view evidence for this hotel/
    );
  });

  it('404s an unknown verification rather than leaking existence', async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(svc().getVerificationPhotos('nope', actor('admin'))).rejects.toThrow(
      /not found/i
    );
  });

  it('surfaces a null URL when storage is unconfigured, rather than hiding it', async () => {
    // A broken bucket must read as a missing image, not as an inspection that
    // never had evidence.
    mockGetPresignedUrl.mockResolvedValue(null);
    const r = await svc().getVerificationPhotos('v1', actor('admin'));
    expect(r.photos[0]).toEqual({ key: VERIFICATION.photo_urls[0], url: null });
  });
});

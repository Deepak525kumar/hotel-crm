import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * SPEC-DOCUMENTS-001 @0.1.4 FROZEN, GD-16 Decided 2026-07-27: route-level
 * authorization regression. GD-16 confirms exactly two upload actors
 * (self-upload worker, manager-upload) and hotel-scoped read; no broader
 * RBAC taxonomy is adopted. This suite pins: admin/manager go through
 * checkWorkerScope() (group-grain), while worker requests bypass it
 * (checkWorkerScope() has no worker branch) and are self-scoped by the
 * service layer instead (see documents-service.test.ts).
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

jest.mock('../config/feature-flags.js', () => ({
  isGD02MatrixEnabled: () => false,
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
    hotel: { findUnique: mockHotelFindUnique },
  }),
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

const ok = (_req: Request, res: Response) => res.status(200).json({ ok: true });
const created = (_req: Request, res: Response) => res.status(201).json({ ok: true });
jest.mock('../modules/documents/controller.js', () => ({
  documentController: {
    uploadDocument: created,
    listWorkerDocuments: ok,
    getDocument: ok,
    getDocumentCompleteness: ok,
    exportWorkerDocuments: ok,
  },
}));

import express from 'express';
import request from 'supertest';
import documentsRouter from '../modules/documents/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/documents', documentsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Documents route authorization (SPEC-DOCUMENTS-001, GD-16)', () => {
  beforeEach(() => {
    testAuth = null;
    mockEmploymentRecordFindUnique.mockReset();
    mockHotelFindUnique.mockReset();
  });

  describe('worker self-service (GD-16 actor 1)', () => {
    it('allows a worker to reach POST /documents/workers/:worker_id/documents', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(201);
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });

    it('allows a worker to reach GET /documents/workers/:worker_id/documents', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/documents/workers/w1/documents');
      expect(res.status).toBe(200);
    });

    // Still 403, but the reason moved: the route's role gate now ADMITS
    // checker (RULE B, 2026-08-12 — a checker onboards and so must be able to
    // upload their own documents), and `c1` != `w1` is what denies this. The
    // checker self-upload and checker-for-another cases are asserted in the
    // self-only block below.
    it('denies a checker uploading for a worker who is not them', async () => {
      testAuth = { userId: 'c1', role: 'checker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(403);
    });
  });

  // RULE B (project-owner decision, 2026-08-12): "nobody may perform another
  // user's onboarding." Upload is SELF-ONLY at the ROUTE (requireSelfWorker,
  // documents/routes.ts) as well as in the service — a hidden button in front
  // of a live route is not a control.
  //
  // This block previously asserted GD-16's "manager-upload (actor 2)"
  // allowance and admin's group-scope bypass. Both are WITHDRAWN by the
  // owner's decision. The assertions are inverted rather than removed: a 201
  // here is now the regression to catch, and admin's 201 was the specific
  // bypass the owner named.
  //
  // Group scope no longer participates: `mgr_1`'s 'g1' claim matching the
  // worker's group is now irrelevant, so `employmentRecord.findUnique` is
  // never consulted for an upload at all — asserted below, because a scope
  // lookup still happening would mean the old middleware was left in the chain.
  describe('upload is self-only for every non-self actor (RULE B, reverses GD-16 actor 2)', () => {
    it('denies a manager uploading for a worker IN their group scope', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(403);
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });

    it('denies a manager uploading for a worker outside their group scope (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(403);
    });

    it('denies an ADMIN uploading for another worker (no bypass — the bypass RULE B closed)', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(403);
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });

    // An admin onboarding THEMSELVES is still permitted — RULE B is about
    // acting on ANOTHER user, not about role. Guards against "fix" by simply
    // banning privileged roles from the route.
    it('allows an admin uploading their OWN document (self, so RULE B permits it)', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp()).post('/documents/workers/a1/documents').send({});
      expect(res.status).toBe(201);
    });

    // A checker onboards too, so the route's role gate admits `checker` now;
    // self-only still applies. The old 'denies checker' case above asserted
    // the role gate itself excluded checker — that changed deliberately.
    it('allows a checker uploading their OWN document', async () => {
      testAuth = { userId: 'c1', role: 'checker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/documents/workers/c1/documents').send({});
      expect(res.status).toBe(201);
    });

    it('denies a checker uploading for another worker', async () => {
      testAuth = { userId: 'c1', role: 'checker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(403);
    });
  });

  it('rejects unauthenticated requests (401)', async () => {
    testAuth = null;
    const res = await request(makeApp()).get('/documents/workers/w1/documents');
    expect(res.status).toBe(401);
  });

  it('bare document-id lookup allows any of the four roles through the route gate', async () => {
    for (const role of ['admin', 'manager', 'regional_manager', 'worker']) {
      testAuth = { userId: 'x1', role, permissions: [], scope: null };
      const res = await request(makeApp()).get('/documents/documents/doc1');
      expect(res.status).toBe(200);
    }
  });

  // GOVERNANCE: `regional_manager` was added to this module's five role gates by
  // explicit project-owner decision (2026-08-04), REVERSING `OD-DOC-007`/`GD-16`
  // ("broader Regional-Manager access explicitly not adopted") in favour of
  // `ADR-030` D-5 / PDD §5.4 ("all Hotel-Manager actions across the group").
  // OD-DOC-007 must be superseded by a Decision Record in the documentation-sync
  // PR; see documents/routes.ts's governance note. Behaviour mirrors the
  // manager-upload cases above exactly — group-scoped via resolveWorkerScope(),
  // which gained its RM branch in the same change.
  describe('regional_manager (owner decision 2026-08-04, supersedes OD-DOC-007)', () => {
    // RULE B (2026-08-12) withdraws RM upload-for-another just as it withdraws
    // the manager's, so this case inverts. The 2026-08-04 owner decision that
    // ADDED regional_manager to this module's gates is not reversed for READS
    // (the list case at the end of this block still passes) — only the WRITE
    // became self-only.
    it('denies a regional_manager uploading for a worker in their group scope (RULE B)', async () => {
      testAuth = {
        userId: 'rm1',
        role: 'regional_manager',
        permissions: [],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(403);
    });

    it('denies a regional_manager uploading for a worker outside their group scope (403)', async () => {
      testAuth = {
        userId: 'rm1',
        role: 'regional_manager',
        permissions: [],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(403);
    });

    it('denies a regional_manager with no scope claim (403, deny-by-default)', async () => {
      testAuth = { userId: 'rm1', role: 'regional_manager', permissions: [], scope: null };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(403);
    });

    it('allows a regional_manager to list documents for a worker in their group', async () => {
      testAuth = {
        userId: 'rm1',
        role: 'regional_manager',
        permissions: [],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).get('/documents/workers/w1/documents');
      expect(res.status).toBe(200);
    });
  });
});

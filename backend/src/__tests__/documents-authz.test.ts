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

    it('denies checker (not a GD-16 actor)', async () => {
      testAuth = { userId: 'c1', role: 'checker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('manager-upload (GD-16 actor 2, group-scoped)', () => {
    it('allows a manager uploading for a worker in their group scope', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(201);
    });

    it('denies a manager uploading for a worker outside their group scope (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(403);
    });

    it('admin bypasses group scope entirely', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp()).post('/documents/workers/w1/documents').send({});
      expect(res.status).toBe(201);
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });
  });

  it('rejects unauthenticated requests (401)', async () => {
    testAuth = null;
    const res = await request(makeApp()).get('/documents/workers/w1/documents');
    expect(res.status).toBe(401);
  });

  it('bare document-id lookup allows any of the three roles through the route gate', async () => {
    for (const role of ['admin', 'manager', 'worker']) {
      testAuth = { userId: 'x1', role, permissions: [], scope: null };
      const res = await request(makeApp()).get('/documents/documents/doc1');
      expect(res.status).toBe(200);
    }
  });
});

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * MIG-GAP-DOC-001 (SPEC-DOCUMENTS-001 RULE-DOC-04, PR #249) -- HR's contract-
 * scan upload stub now delegates to backend-documents' DocumentService
 * in-process, instead of throwing NotImplementedError. Unlike
 * hr-authz.test.ts (which mocks hrController entirely and never sends a
 * real file), this suite exercises the real HrController -> HrService ->
 * DocumentService chain, with only storage/db mocked -- proving actual file
 * bytes flow all the way from HR's route into a persisted WorkerDocument
 * row, classified GENERAL (no CONTRACT_SCAN category is ratified,
 * OD-DOC-005's category-taxonomy half remains Open, non-blocking).
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

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

const mockWorkerDocumentCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => {
  const mockDb = {
    workerDocument: { create: mockWorkerDocumentCreate },
    auditLog: { create: mockAuditLogCreate },
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
  };
  return {
    getPrisma: () => ({
      ...mockDb,
      $transaction: async (cb: any) => cb(mockDb),
    }),
  };
});

const mockUpload = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
jest.mock('../modules/documents/storage.js', () => ({
  generateStorageKey: (workerId: string, category: string, filename: string) =>
    `documents/${workerId}/${category.toLowerCase()}/test-uuid/${filename}`,
  getStorageClient: async () => ({
    upload: mockUpload,
    getPresignedUrl: async () => null,
    delete: jest.fn(),
  }),
}));

import express from 'express';
import request from 'supertest';
import hrRouter from '../modules/hr/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/hr', hrRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('HR document upload delegates to backend-documents (MIG-GAP-DOC-001)', () => {
  beforeEach(() => {
    testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
    mockWorkerDocumentCreate.mockReset();
    mockAuditLogCreate.mockReset();
    mockEmploymentRecordFindUnique.mockReset();
    mockUpload.mockReset();
    mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockWorkerDocumentCreate.mockResolvedValue({
      id: 'd1',
      worker_id: 'w1',
      uploaded_by_id: 'm1',
      category: 'CONTRACT_SCAN',
      s3_key: 'documents/w1/general/test-uuid/contract.pdf',
      original_filename: 'contract.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 5,
      expires_at: null,
      is_work_permit: false,
      created_at: new Date('2026-07-28T00:00:00.000Z'),
      updated_at: new Date('2026-07-28T00:00:00.000Z'),
    });
  });

  it('persists the scanned contract as a CONTRACT_SCAN WorkerDocument, not a NotImplementedError', async () => {
    const fileContents = Buffer.from('%PDF-');

    const res = await request(makeApp())
      .post('/hr/workers/w1/documents')
      .attach('file', fileContents, { filename: 'contract.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(mockWorkerDocumentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          worker_id: 'w1',
          uploaded_by_id: 'm1', // RULE-DOC-08: actor derived from req.auth, not client input
          category: 'CONTRACT_SCAN',
          file_size_bytes: fileContents.length,
        }),
      })
    );
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [, uploadedBuffer] = mockUpload.mock.calls[0] as [string, Buffer, string];
    expect(Buffer.compare(uploadedBuffer, fileContents)).toBe(0);
  });

  it('rejects the request with 422 when no file is attached (same contract as backend-documents)', async () => {
    const res = await request(makeApp()).post('/hr/workers/w1/documents');
    expect(res.status).toBe(422);
    expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
  });

  it('rejects a disallowed MIME type with 422 before reaching the service', async () => {
    const res = await request(makeApp())
      .post('/hr/workers/w1/documents')
      .attach('file', Buffer.from('bad'), { filename: 'malware.exe', contentType: 'application/x-msdownload' });

    expect(res.status).toBe(422);
    expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
  });

  it('still denies a manager outside their group scope with 403, before any file is parsed', async () => {
    mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });

    const res = await request(makeApp())
      .post('/hr/workers/w1/documents')
      .attach('file', Buffer.from('x'), { filename: 'contract.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
    expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
  });

  it('still denies worker/checker roles with 403 (unchanged HR route gate)', async () => {
    for (const role of ['worker', 'checker']) {
      testAuth = { userId: 'x1', role, permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/hr/workers/w1/documents')
        .attach('file', Buffer.from('x'), { filename: 'contract.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(403);
    }
    expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
  });
});

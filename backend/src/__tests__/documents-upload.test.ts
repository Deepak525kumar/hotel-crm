import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * SPEC-DOCUMENTS-001 @0.1.4 FROZEN, GD-16 Decided 2026-07-27 -- PR #247:
 * multipart upload wiring regression. Exercises the real multer middleware
 * chain (memory storage, MIME allowlist, size limit) and the real
 * DocumentController/DocumentService, with only storage/db mocked -- unlike
 * documents-authz.test.ts (which mocks the controller and never sends a real
 * file) this suite proves actual file bytes reach DocumentService.uploadDocument.
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

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    workerDocument: { create: mockWorkerDocumentCreate },
    auditLog: { create: mockAuditLogCreate },
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
    $transaction: jest.fn(async (cb: any) => cb({
      workerDocument: { create: mockWorkerDocumentCreate },
      auditLog: { create: mockAuditLogCreate }
    })) as jest.MockedFunction<(...args: any[]) => any>,
  }),
}));

// Isolates from env.S3_BUCKET (set in local .env for real dev use) -- same
// approach as documents-service.test.ts. Captures the buffer passed to
// storage.upload() so the test can assert on the ACTUAL bytes received.
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
import documentsRouter from '../modules/documents/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/documents', documentsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({
      error: err.name,
      message: err.message,
      ...(err instanceof AppError && err.details.length > 0 ? { details: err.details } : {}),
    });
  });
  return app;
}

describe('Documents multipart upload (PR #247)', () => {
  beforeEach(() => {
    testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    mockWorkerDocumentCreate.mockReset();
    mockAuditLogCreate.mockReset();
    mockEmploymentRecordFindUnique.mockReset();
    mockUpload.mockReset();
    mockWorkerDocumentCreate.mockResolvedValue({
      id: 'd1',
      worker_id: 'w1',
      uploaded_by_id: 'w1',
      category: 'GENERAL',
      s3_key: 'documents/w1/general/test-uuid/id.pdf',
      original_filename: 'id.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 12,
      expires_at: null,
      is_work_permit: false,
      created_at: new Date('2026-07-28T00:00:00.000Z'),
      updated_at: new Date('2026-07-28T00:00:00.000Z'),
    });
  });

  it('accepts a real multipart upload and forwards the actual file bytes to the service', async () => {
    const fileContents = Buffer.from('hello world!');

    const res = await request(makeApp())
      .post('/documents/workers/w1/documents')
      .field('category', 'GENERAL')
      .field('original_filename', 'id.pdf')
      .field('mime_type', 'application/pdf')
      .attach('file', fileContents, { filename: 'id.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [, uploadedBuffer, uploadedMime] = mockUpload.mock.calls[0] as [string, Buffer, string];
    expect(Buffer.compare(uploadedBuffer, fileContents)).toBe(0);
    expect(uploadedMime).toBe('application/pdf');

    // file_size_bytes is derived server-side from the parsed buffer, not
    // trusted from any client-supplied field (RULE-DOC-09).
    expect(mockWorkerDocumentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ file_size_bytes: fileContents.length }),
      })
    );
  });

  it('rejects the request with 422 when no file is attached', async () => {
    const res = await request(makeApp())
      .post('/documents/workers/w1/documents')
      .field('category', 'GENERAL')
      .field('original_filename', 'id.pdf')
      .field('mime_type', 'application/pdf');

    expect(res.status).toBe(422);
    expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
  });

  it('rejects a disallowed MIME type with 422 before reaching the service', async () => {
    const res = await request(makeApp())
      .post('/documents/workers/w1/documents')
      .field('category', 'GENERAL')
      .field('original_filename', 'malware.exe')
      .field('mime_type', 'application/x-msdownload')
      .attach('file', Buffer.from('bad'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(422);
    expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
  });

  it('rejects a file exceeding the 10MB limit with 422', async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);

    const res = await request(makeApp())
      .post('/documents/workers/w1/documents')
      .field('category', 'GENERAL')
      .field('original_filename', 'big.pdf')
      .field('mime_type', 'application/pdf')
      .attach('file', oversized, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated multipart upload with 401 before parsing', async () => {
    testAuth = null;
    const res = await request(makeApp())
      .post('/documents/workers/w1/documents')
      .field('category', 'GENERAL')
      .field('original_filename', 'id.pdf')
      .field('mime_type', 'application/pdf')
      .attach('file', Buffer.from('x'), { filename: 'id.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(401);
    expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
  });

  it('rejects a manager uploading outside their group scope with 403 before parsing the file', async () => {
    testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
    mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });

    const res = await request(makeApp())
      .post('/documents/workers/w1/documents')
      .field('category', 'GENERAL')
      .field('original_filename', 'id.pdf')
      .field('mime_type', 'application/pdf')
      .attach('file', Buffer.from('x'), { filename: 'id.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
    expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
  });
});

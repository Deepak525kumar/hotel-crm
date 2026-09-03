import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

// Storage is mocked, not merely unconfigured: createVerification()/createRating()
// call uploadPhotos(), which resolves a REAL S3 client whenever S3_BUCKET is set,
// so without this these tests perform live network I/O — green on a workstation
// with working AWS credentials, red in CI. Mirrors quality-photos-authz.test.ts.
jest.mock('../modules/documents/storage.js', () => ({
  getStorageClient: async () => ({
    upload: async () => undefined,
    uploadFile: async () => undefined,
    getPresignedUrl: async () => 'https://signed.example/p.jpg',
    delete: async () => undefined,
  }),
  generateQualityPhotoKey: (assignmentId: string, kind: string, name: string) =>
    `quality/${assignmentId}/${kind}/test-uuid/${name}`,
}));

/**
 * TREQ-005 over the real HTTP path.
 *
 * The sibling inspection-checklist.test.ts exercises CreateRatingSchema
 * directly. That is necessary but not sufficient, and this repo has already
 * been bitten by exactly the gap between the two: `score` was declared
 * z.number() and every schema-level test passed, while every real request
 * failed, because the transport delivered a string (PR #495, multipart).
 *
 * So this drives Express -- real router, real express.json(), real validation,
 * real controller -- rather than calling the schema. POST /quality/inspections has
 * no multer on it (unlike /quality/verifications), so criteria_scores arrives
 * as genuine JSON numbers; this test is what makes that claim checkable
 * instead of a comment, and it fails if the route is ever moved to multipart
 * without coercion being added.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

const created: any[] = [];

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

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    workerAssignment: {
      findUnique: async () => ({
        id: 'asg_1',
        hotel_id: 'h1',
        worker_id: 'w1',
        status: 'COMPLETED',
      }),
    },
    // The duplicate pre-check recordInspection runs before writing.
    qualityVerification: { findUnique: async () => null },
    $transaction: async (fn: any) =>
      fn({
        // The checklist is captured off qualityVerification.create since the
        // Rating merge (2026-08-29) -- this used to watch rating.create, which
        // is the write that no longer happens.
        qualityVerification: {
          create: async ({ data }: any) => {
            created.push(data);
            return { id: 'qv_1', ...data, created_at: new Date(), updated_at: new Date() };
          },
          aggregate: async () => ({ _avg: { score: 80 }, _count: 1 }),
          findMany: async () => [{ score: 80 }],
        },
        workerAssignment: {
          count: async () => 1,
          findFirst: async () => null,
          findUnique: async () => ({
            id: 'asg_1',
            hotel_id: 'h1',
            worker_id: 'w1',
            status: 'COMPLETED',
          }),
          update: async () => ({}),
        },
        attendance: { count: async () => 1 },
        workerOverallRating: { upsert: async () => ({}), findUnique: async () => null },
        notification: { create: async () => ({}) },
        outboxEvent: { create: async () => ({}) },
        user: { findUnique: async () => ({ first_name: 'T', last_name: 'U' }) },
        $executeRawUnsafe: async () => 0,
      }),
    auditLog: { create: async () => undefined },
  }),
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import qualityRouter from '../modules/quality/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/quality', qualityRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

// Admin, not checker: a checker is additionally gated by "must have an active
// assignment at the same hotel on the same day", which is a separate rule with
// its own coverage. Using a checker here would make this file fail for a reason
// that has nothing to do with the checklist.
const ADMIN = {
  userId: 'adm1',
  role: 'admin',
  permissions: ['quality:write', 'quality:read'],
  scope: null,
};

describe('inspection checklist over HTTP (TREQ-005)', () => {
  beforeEach(() => {
    testAuth = ADMIN;
    created.length = 0;
  });

  it('accepts the confirmed checklist and persists it verbatim', async () => {
    const res = await request(makeApp())
      .post('/quality/inspections')
      // Multipart, and criteria_scores JSON-stringified into one field:
      // CRR §15's photo is enforced on ratings as of 2026-08-24, and
      // multipart's flat field model cannot carry a nested object.
      .field('assignment_id', 'asg_1')
      .field('worker_id', 'w1')
      .field('score', '80')
      .field('outcome', 'complete')
      .field('room_number', '412')
      .field('criteria_scores', JSON.stringify({ dust: 90, bathroom: 70, bed_linen: 100 }))
      .attach('photos', Buffer.from('x'), { filename: 'e.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    // Verify what was actually written, not just the status code -- a 201
    // that dropped criteria_scores would otherwise read as a pass.
    expect(created[0].criteria_scores).toEqual({ dust: 90, bathroom: 70, bed_linen: 100 });
  });

  it('rejects the pre-pivot keys at the HTTP boundary', async () => {
    const res = await request(makeApp())
      .post('/quality/inspections')
      .send({
        assignment_id: 'asg_1',
        worker_id: 'w1',
        score: 80,
        outcome: 'complete',
        room_number: '412',
        criteria_scores: { punctuality: 90 },
      });

    expect(res.status).toBe(422);
    expect(created).toHaveLength(0);
  });

  it('rejects an out-of-range checklist value', async () => {
    const res = await request(makeApp())
      .post('/quality/inspections')
      .send({
        assignment_id: 'asg_1',
        worker_id: 'w1',
        score: 80,
        outcome: 'complete',
        room_number: '412',
        criteria_scores: { dust: 5000 },
      });

    expect(res.status).toBe(422);
  });

  it('still accepts a rating with no checklist at all', async () => {
    const res = await request(makeApp())
      .post('/quality/inspections')
      .field('assignment_id', 'asg_1')
      .field('worker_id', 'w1')
      .field('score', '80')
      .field('outcome', 'complete')
      .field('room_number', '412')
      .attach('photos', Buffer.from('x'), { filename: 'e.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
  });

  it('rejects a rating with no photo (CRR §15)', async () => {
    const res = await request(makeApp())
      .post('/quality/inspections')
      .send({ assignment_id: 'asg_1', worker_id: 'w1', score: 80 });

    expect(res.status).toBe(422);
  });
});

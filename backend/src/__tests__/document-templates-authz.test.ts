import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Document Templates module (2026-08-09): route-gate regression, mirroring
 * documents-authz.test.ts's pattern. Pins requireRole()/requirePermission()
 * at the router boundary; RBAC/IDOR enforcement that depends on loaded
 * instance/scope state lives in document-templates-service.test.ts instead
 * (this suite stubs the controller so no service logic runs here).
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

const mockInstanceSignatureCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockInstanceSignatureUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

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

const ok = (_req: Request, res: Response) => res.status(200).json({ ok: true });
const created = (_req: Request, res: Response) => res.status(201).json({ ok: true });
jest.mock('../modules/document-templates/controller.js', () => ({
  documentTemplatesController: {
    createTemplate: created,
    listTemplates: ok,
    getTemplate: ok,
    updateTemplate: ok,
    addSection: created,
    updateSection: ok,
    addField: created,
    updateField: ok,
    addSignatureBlock: created,
    publishTemplate: ok,
    archiveTemplate: ok,
    createInstance: created,
    listInstances: ok,
    getInstance: ok,
    upsertFieldValues: ok,
    previewInstance: ok,
    signBlock: created,
    listSignatures: ok,
    finalize: ok,
    getFinalDocument: ok,
  },
  documentInstanceSignature: {
    create: mockInstanceSignatureCreate,
    update: mockInstanceSignatureUpdate,
  },
}));

import express from 'express';
import request from 'supertest';
import { documentTemplateRoutes, documentInstanceRoutes } from '../modules/document-templates/routes.js';
import { Router } from 'express';

const documentTemplatesRouter = Router();
documentTemplatesRouter.use('/document-templates', documentTemplateRoutes);
documentTemplatesRouter.use('/document-instances', documentInstanceRoutes);
import { AppError } from '../lib/errors.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', documentTemplatesRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

function permsFor(role: keyof typeof ROLE_PERMISSIONS): string[] {
  return [...ROLE_PERMISSIONS[role]];
}

describe('Document Templates route authorization', () => {
  beforeEach(() => {
    testAuth = null;
  });

  it('rejects unauthenticated requests (401)', async () => {
    const res = await request(makeApp()).get('/document-templates');
    expect(res.status).toBe(401);
  });

  describe('template authoring — admin only', () => {
    it('allows admin to create a template', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: permsFor('ADMIN'), scope: null };
      const res = await request(makeApp()).post('/document-templates').send({ name: 'x' });
      expect(res.status).toBe(201);
    });

    it('denies manager creating a template (write is admin-only)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: permsFor('MANAGER'), scope: null };
      const res = await request(makeApp()).post('/document-templates').send({ name: 'x' });
      expect(res.status).toBe(403);
    });

    it('denies worker creating a template', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: permsFor('WORKER'), scope: null };
      const res = await request(makeApp()).post('/document-templates').send({ name: 'x' });
      expect(res.status).toBe(403);
    });

    it('allows manager/RM to read templates (list)', async () => {
      for (const role of ['manager', 'regional_manager'] as const) {
        testAuth = {
          userId: 'm1',
          role,
          permissions: permsFor(role === 'manager' ? 'MANAGER' : 'REGIONAL_MANAGER'),
          scope: null,
        };
        const res = await request(makeApp()).get('/document-templates');
        expect(res.status).toBe(200);
      }
    });

    it('denies worker reading templates (no document_templates:read token)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: permsFor('WORKER'), scope: null };
      const res = await request(makeApp()).get('/document-templates');
      expect(res.status).toBe(403);
    });
  });

  describe('instances — worker fill/read-own', () => {
    it('allows a worker to create an instance (fill-own token)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: permsFor('WORKER'), scope: null };
      const res = await request(makeApp()).post('/document-instances').send({ template_id: 't1', worker_id: 'w1' });
      expect(res.status).toBe(201);
    });

    it('allows a worker to read their own instances', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: permsFor('WORKER'), scope: null };
      const res = await request(makeApp()).get('/document-instances');
      expect(res.status).toBe(200);
    });

    it('allows a manager to create/fill an instance (write token)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: permsFor('MANAGER'), scope: null };
      const res = await request(makeApp()).post('/document-instances').send({ template_id: 't1', worker_id: 'w1' });
      expect(res.status).toBe(201);
    });

    it('denies a checker (not a document-templates actor at all)', async () => {
      testAuth = { userId: 'c1', role: 'checker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/document-instances');
      expect(res.status).toBe(403);
    });
  });

  describe('signature route — multer + sign-own/write tokens', () => {
    it('allows a worker (sign-own token) to reach the sign route', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: permsFor('WORKER'), scope: null };
      const res = await request(makeApp())
        .post('/document-instances/i1/signature-blocks/b1/sign')
        .attach('file', Buffer.from('fake-png'), { filename: 'sig.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
    });

    it('rejects a non-png upload on the sign route (415/400-class, not 500)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: permsFor('WORKER'), scope: null };
      const res = await request(makeApp())
        .post('/document-instances/i1/signature-blocks/b1/sign')
        .attach('file', Buffer.from('not a png'), { filename: 'sig.txt', contentType: 'text/plain' });
      expect(res.status).toBeLessThan(500);
      expect(res.status).not.toBe(201);
    });
  });
});

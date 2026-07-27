// SPEC-DOCUMENTS-001 @0.1.4 FROZEN (GD-16 Decided 2026-07-27).
// Thin HTTP adapter: parses/validates request shape, derives the actor
// exclusively from req.auth (RULE-DOC-08), and delegates to DocumentService.

import { Request, Response, NextFunction } from 'express';
import { documentService } from './service.js';
import { uploadDocumentSchema } from './validation.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import type { DocumentCategoryType } from './types.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

export class DocumentController {
  // IF-DOC-UploadDocument
  async uploadDocument(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const parsed = uploadDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
        return;
      }

      // RULE-DOC-09 defence-in-depth: no file-parsing middleware is wired on
      // this route yet (mirrors the current backend-hr stub's gap, tracked
      // separately) — the buffer is empty until multipart handling lands.
      const fileBuffer = Buffer.alloc(0);

      const result = await documentService.uploadDocument(
        {
          worker_id: req.params.worker_id,
          actor_id: req.auth.userId,
          category: parsed.data.category,
          original_filename: parsed.data.original_filename,
          mime_type: parsed.data.mime_type,
          file_size_bytes: parsed.data.file_size_bytes,
          is_work_permit: parsed.data.is_work_permit,
          expires_at: parsed.data.expires_at,
        },
        fileBuffer,
        req.auth.role,
        req.ip
      );

      res.status(201).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // IF-DOC-ListWorkerDocuments
  async listWorkerDocuments(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const category = req.query.category as DocumentCategoryType | undefined;
      const result = await documentService.listWorkerDocuments(
        req.params.worker_id,
        req.auth.userId,
        req.auth.role,
        category
      );
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // IF-DOC-GetDocument
  async getDocument(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await documentService.getDocument(
        req.params.document_id,
        req.auth.userId,
        req.auth.role
      );
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // IF-DOC-GetDocumentCompleteness
  async getDocumentCompleteness(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const isWorkPermitRequired = req.query.work_permit_required === 'true';
      const result = await documentService.getDocumentCompleteness(
        req.params.worker_id,
        isWorkPermitRequired
      );
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // IF-DOC-ExportWorkerDocuments
  async exportWorkerDocuments(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await documentService.exportWorkerDocuments(
        req.params.worker_id,
        req.auth.userId,
        req.auth.role
      );
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const documentController = new DocumentController();

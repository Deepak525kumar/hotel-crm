import { Request, Response, NextFunction } from 'express';
import { documentTemplatesService } from './service.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import {
  CreateFieldSchema,
  CreateInstanceSchema,
  CreateSectionSchema,
  CreateSignatureBlockSchema,
  CreateTemplateSchema,
  ListInstancesQuerySchema,
  UpdateFieldSchema,
  UpdateSectionSchema,
  UpdateTemplateSchema,
  UpsertFieldValuesSchema,
  ListTemplatesQuerySchema,
} from './types.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

function actorFrom(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return { userId: req.auth.userId, role: req.auth.role, scope: req.auth.scope ?? null };
}

export class DocumentTemplatesController {
  // -- Templates -----------------------------------------------------------

  async createTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const parsed = CreateTemplateSchema.safeParse(req.body);
      if (!parsed.success) return next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      const result = await documentTemplatesService.createTemplate(parsed.data, actor);
      res.status(201).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async listTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      actorFrom(req);
      const parsed = ListTemplatesQuerySchema.safeParse(req.query);
      if (!parsed.success) return next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
      const result = await documentTemplatesService.listTemplates(parsed.data);
      res.status(200).json({ status: 'success', data: result.data, meta: { total: result.total, timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async getTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const result = await documentTemplatesService.getTemplate(req.params.id, actor);
      res.status(200).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async updateTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const parsed = UpdateTemplateSchema.safeParse(req.body);
      if (!parsed.success) return next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      const result = await documentTemplatesService.updateTemplate(req.params.id, parsed.data, actor);
      res.status(200).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async addSection(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const parsed = CreateSectionSchema.safeParse(req.body);
      if (!parsed.success) return next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      const result = await documentTemplatesService.addSection(req.params.id, parsed.data, actor);
      res.status(201).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async updateSection(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const parsed = UpdateSectionSchema.safeParse(req.body);
      if (!parsed.success) return next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      const result = await documentTemplatesService.updateSection(req.params.id, req.params.sid, parsed.data, actor);
      res.status(200).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async addField(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const parsed = CreateFieldSchema.safeParse(req.body);
      if (!parsed.success) return next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      const result = await documentTemplatesService.addField(req.params.id, req.params.sid, parsed.data, actor);
      res.status(201).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async updateField(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const parsed = UpdateFieldSchema.safeParse(req.body);
      if (!parsed.success) return next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      const result = await documentTemplatesService.updateField(req.params.id, req.params.sid, req.params.fid, parsed.data, actor);
      res.status(200).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async addSignatureBlock(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const parsed = CreateSignatureBlockSchema.safeParse(req.body);
      if (!parsed.success) return next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      const result = await documentTemplatesService.addSignatureBlock(req.params.id, req.params.sid, parsed.data, actor);
      res.status(201).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async publishTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const result = await documentTemplatesService.publishTemplate(req.params.id, actor);
      res.status(200).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async archiveTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const result = await documentTemplatesService.archiveTemplate(req.params.id, actor);
      res.status(200).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  // -- Instances -------------------------------------------------------------

  async createInstance(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const parsed = CreateInstanceSchema.safeParse(req.body);
      if (!parsed.success) return next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      const result = await documentTemplatesService.createInstance(parsed.data, actor);
      res.status(201).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async listInstances(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const parsed = ListInstancesQuerySchema.safeParse(req.query);
      if (!parsed.success) return next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
      const { data, total } = await documentTemplatesService.listInstances(parsed.data, actor);
      const { page, per_page } = parsed.data;
      res.status(200).json({
        status: 'success',
        data,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: req.requestId,
          pagination: {
            page,
            per_page,
            total,
            total_pages: Math.ceil(total / per_page),
            has_next: page * per_page < total,
            has_prev: page > 1,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getInstance(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const result = await documentTemplatesService.getInstance(req.params.id, actor);
      res.status(200).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async upsertFieldValues(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const parsed = UpsertFieldValuesSchema.safeParse(req.body);
      if (!parsed.success) return next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      const result = await documentTemplatesService.upsertFieldValues(req.params.id, parsed.data, actor);
      res.status(200).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async previewInstance(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const pdf = await documentTemplatesService.previewInstance(req.params.id, actor);
      res.status(200).setHeader('Content-Type', 'application/pdf').send(pdf);
    } catch (error) {
      next(error);
    }
  }

  async signBlock(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      if (!req.file) {
        next(new ValidationError('A signature image is required', [{ field: 'file', message: 'required' }]));
        return;
      }
      const result = await documentTemplatesService.signBlock(
        req.params.id,
        req.params.blockId,
        req.file.buffer,
        actor,
        req.ip
      );
      res.status(201).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async listSignatures(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const result = await documentTemplatesService.listSignatures(req.params.id, actor);
      res.status(200).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async finalize(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const result = await documentTemplatesService.finalize(req.params.id, actor);
      res.status(200).json({ status: 'success', data: result, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }

  async getFinalDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = actorFrom(req);
      const url = await documentTemplatesService.getFinalDocumentUrl(req.params.id, actor);
      res.status(200).json({ status: 'success', data: { url }, meta: { timestamp: new Date().toISOString(), request_id: req.requestId } });
    } catch (error) {
      next(error);
    }
  }
}

export const documentTemplatesController = new DocumentTemplatesController();

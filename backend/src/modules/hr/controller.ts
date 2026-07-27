import { Request, Response, NextFunction } from 'express';
import { hrService } from './service.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';

export class HrController {
  async createContract(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await hrService.createContract(req.body);
      res.status(201).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async listContracts(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await hrService.listContracts(req.query);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async createPayroll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await hrService.createPayroll(req.body);
      res.status(201).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async listPayroll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await hrService.listPayroll(req.query);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // MIG-GAP-DOC-001: mechanism-class upload (RULE-DOC-04) — the actual file
  // is required and, per RULE-DOC-08, the acting actor is always derived
  // from req.auth, never a client-supplied field.
  async uploadDocument(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      if (!req.file) {
        next(new ValidationError('A file is required', [{ field: 'file', message: 'required' }]));
        return;
      }

      const result = await hrService.uploadDocument(
        req.params.worker_id,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        req.auth.userId,
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
}

export const hrController = new HrController();

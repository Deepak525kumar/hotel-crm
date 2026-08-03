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

  // ADR-043: Admin sees all; Manager's results are scoped to their own
  // hotel_group_id inside hrService.listContracts() itself.
  async listContracts(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await hrService.listContracts(req.query, {
        role: req.auth.role,
        scope: req.auth.scope,
        userId: req.auth.userId,
      });
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // IF-HR-GetContractStatus. OD-HR-10 (FIND-SEC-HR-03, IDOR): worker-role
  // scoping is enforced inside hrService.getContractStatus() itself, since
  // this route carries no checkWorkerScope() call (worker self-read path).
  async getContractStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await hrService.getContractStatus(
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

  // IF-HR-UploadSignedContract. RULE-HR-14: manager identity is req.auth
  // only, never client-supplied — mirrors uploadDocument() below exactly.
  async uploadSignedContract(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      if (!req.file) {
        next(new ValidationError('A file is required', [{ field: 'file', message: 'required' }]));
        return;
      }

      const result = await hrService.uploadSignedContract(
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

  // IF-HR-ConfirmContractSigned. RULE-HR-14: confirming manager identity is
  // req.auth only, never client-supplied request data.
  async confirmContractSigned(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await hrService.confirmContractSigned(
        req.params.worker_id,
        req.auth.userId,
        req.auth.role,
        req.ip
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

  // RULE-HR-06/07, ADR-040: manager-only confirmation, no worker veto.
  async extendContract(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await hrService.extendContract(req.params.worker_id, req.auth.userId, req.auth.role);
      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // ADR-040 PATH (a) only: explicit manager "do not continue" action.
  async manualLapseContract(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await hrService.manualLapseContract(
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

  // IF-HR-RequestPayslip (worker-self route). OD-HR-10 (FIND-SEC-HR-03,
  // IDOR): worker_id is ALWAYS req.auth.userId here — this route never
  // accepts a client-supplied worker_id, unlike createPayroll below (the
  // separate Manager/Admin-initiated route).
  async requestPayslip(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await hrService.requestPayslip({
        worker_id: req.auth.userId,
        period_start: req.body.period_start,
        period_end: req.body.period_end,
      });
      res.status(201).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  // IF-HR-CreatePayroll (Manager/Admin-initiated, worker_id from the request
  // body — checkWorkerScope() at the route layer enforces group scope).
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

  // IF-HR-FulfilPayslipRequest. Manager/Admin marks a request emailed.
  // OD-HR-13: req.auth.scope is passed through so the service can resolve
  // the request's own worker_id -> hotel_group_id scope check itself — this
  // route has no worker_id path param for checkWorkerScope() to gate on.
  async fulfilPayslipRequest(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await hrService.fulfilPayslipRequest(
        req.params.request_id,
        req.auth.userId,
        req.auth.role,
        req.auth.scope
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

  // ADR-043: Admin sees all; Manager's results are scoped to their own
  // hotel_group_id inside hrService.listPayroll() itself. Worker is self-scoped
  // via the IDOR guard in hrService.listPayroll (OD-HR-10/FIND-SEC-HR-03) —
  // userId is passed so the service can enforce it without trusting query params.
  async listPayroll(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();
      const result = await hrService.listPayroll(req.query, {
        role: req.auth.role,
        scope: req.auth.scope,
        userId: req.auth.userId,
      });
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

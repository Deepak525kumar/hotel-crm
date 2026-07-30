import { Request, Response, NextFunction } from 'express';
import { consentService } from './service.js';
import {
  RecordDecisionSchema,
  WithdrawConsentSchema,
  CheckStatusQuerySchema,
  GetAuditHistoryQuerySchema,
} from './types.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

export class ConsentController {
  // IF-CONSENT-CheckStatus: worker_id is always req.auth.userId, never a
  // client-supplied field -- mirrors RULE-HR-14's identical precedent.
  async checkStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const parsed = CheckStatusQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
        return;
      }

      const result = await consentService.checkStatus(req.auth.userId, parsed.data.consent_instance);

      res.status(200).json({
        status: 'success',
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }

  async requestConsent(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const consentInstance =
        typeof req.body?.consent_instance === 'string' ? req.body.consent_instance : undefined;
      if (!consentInstance) {
        next(
          new ValidationError('Invalid request body', [
            { field: 'consent_instance', message: 'required' },
          ])
        );
        return;
      }

      const result = await consentService.requestConsent(
        consentInstance,
        typeof req.body?.language === 'string' ? req.body.language : undefined
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

  // IF-CONSENT-RecordDecision: worker_id is always req.auth.userId
  // (self-only -- this module must never accept a worker-id parameter for
  // a different worker's decision).
  async recordDecision(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const parsed = RecordDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
        return;
      }

      const result = await consentService.recordDecision(
        req.auth.userId,
        req.auth.role,
        parsed.data,
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

  // IF-CONSENT-WithdrawConsent: self-scoped only.
  async withdrawConsent(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const parsed = WithdrawConsentSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
        return;
      }

      const result = await consentService.withdrawConsent(
        req.auth.userId,
        req.auth.role,
        parsed.data.consent_instance,
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

  // IF-CONSENT-GetAuditHistory: worker self-scope or Admin (rides
  // Compliance's existing governance-read path, OD-CONSENT-011/ADR-037 --
  // no backend-compliance code exists yet).
  async getAuditHistory(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const parsed = GetAuditHistoryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        next(new ValidationError('Invalid query parameters', zodDetails(parsed.error)));
        return;
      }

      const result = await consentService.getAuditHistory(parsed.data, {
        userId: req.auth.userId,
        role: req.auth.role,
      });

      res.status(200).json({
        status: 'success',
        data: result.data,
        pagination: {
          page: parsed.data.page,
          per_page: parsed.data.per_page,
          total: result.total,
          total_pages: Math.ceil(result.total / parsed.data.per_page),
          has_next: parsed.data.page * parsed.data.per_page < result.total,
          has_prev: parsed.data.page > 1,
        },
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const consentController = new ConsentController();

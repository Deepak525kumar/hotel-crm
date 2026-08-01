import { Request, Response, NextFunction } from 'express';
import { complianceService } from './service.js';
import { UnauthorizedError } from '../../lib/errors.js';

// SPEC-COMPLIANCE-001@0.1.0 REVIEW (NOT FROZEN), PR 3 of 4. Only
// IF-COMPLIANCE-FulfilSubjectRightsRequest is routed -- IF-COMPLIANCE-
// GetAuditTrail remains in-process-only by design (see service.ts's own
// header comment). worker_id is always req.auth.userId, never a URL/body
// param, mirroring IF-CONSENT-CheckStatus's identical "always the caller's
// own id" pattern (docs/03-modules/consent/MODULE_SPEC.md) -- this
// interface has no Admin-on-behalf-of-worker path named anywhere in the
// spec, unlike backend-documents'/backend-consent's own dual self-or-Admin
// routes, so there is no second identity source to accept.
export class ComplianceController {
  async fulfilSubjectRightsRequest(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const result = await complianceService.fulfilSubjectRightsRequest(req.auth.userId);

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

export const complianceController = new ComplianceController();

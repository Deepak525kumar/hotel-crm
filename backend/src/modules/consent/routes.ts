// SPEC-CONSENT-001@0.2.0 FROZEN (ADR-015/ADR-037, GD-17 Decided 2026-07-27/28).
// GD-17/RULE-CONSENT-*: self-checkin/self-decision only for writes (any
// authenticated role may decide/withdraw their own consent -- self-scope is
// itself the authorization, mirroring GeoService's identical actor model);
// GetAuditHistory is self-or-Admin (OD-CONSENT-011/ADR-037). No new
// permission tokens are introduced -- role/self-scope gating alone matches
// this module's confirmed actor model.

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { consentController } from './controller.js';

const router = Router();
router.use(authMiddleware);

// IF-CONSENT-CheckStatus: any authenticated role, self-scoped (worker_id is
// always req.auth.userId, enforced in controller.ts/service.ts).
router.get('/status', (req, res, next) => consentController.checkStatus(req, res, next));

// Whether the daily gate is enforced FOR THIS CALLER. Not part of
// IF-CONSENT-CheckStatus (whose shape is frozen spec) -- this answers an
// operational question so the FEATURE_CONSENT_GATE kill switch reaches the
// clients' own consent screens, not just the API.
router.get('/gate-state', (req, res, next) => consentController.getGateState(req, res, next));

// IF-CONSENT-RequestConsent: any authenticated role -- the caller is always
// the worker's own session (worker-facing consent-notice presentation);
// in-process consumers (Onboarding/Chatbot) invoke ConsentService directly
// once those modules exist, not through this HTTP route.
router.post('/request', (req, res, next) => consentController.requestConsent(req, res, next));

// IF-CONSENT-RecordDecision: self-scoped only.
router.post('/decisions', (req, res, next) => consentController.recordDecision(req, res, next));

// IF-CONSENT-WithdrawConsent: self-scoped only.
router.post('/withdraw', (req, res, next) => consentController.withdrawConsent(req, res, next));

// IF-CONSENT-GetAuditHistory: self-scoped or Admin (OD-CONSENT-011/ADR-037),
// enforced in service.ts.
router.get('/audit-history', (req, res, next) => consentController.getAuditHistory(req, res, next));

export default router;

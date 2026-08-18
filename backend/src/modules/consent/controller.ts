import { Request, Response, NextFunction } from 'express';
import { consentService } from './service.js';
import { getConsentGateRoles, isConsentGateEnabled } from '../../config/feature-flags.js';
import {
  RecordDecisionSchema,
  WithdrawConsentSchema,
  CheckStatusQuerySchema,
  GetAuditHistoryQuerySchema,
} from './types.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { getPrisma } from '../../lib/db.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

// 2026-08-16: the caller's stored UI-language preference, or undefined when
// they have never chosen one. Undefined (not DEFAULT_LANGUAGE) on purpose —
// requestConsent already owns the unsupported/absent-language fallback per
// OD-CONSENT-009, and duplicating that decision here would give this module
// a second, competing default.
//
// A failed lookup is swallowed rather than propagated: the language of a
// notice is a presentation concern, and a transient database hiccup reading
// a preference must never block a GDPR consent flow that would otherwise
// succeed in the default language.
async function getPreferredLanguage(userId: string): Promise<string | undefined> {
  try {
    const user = await getPrisma().user.findUnique({
      where: { id: userId },
      select: { preferred_language: true },
    });
    return user?.preferred_language ?? undefined;
  } catch {
    return undefined;
  }
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

      // 2026-08-16 (language-change feature): an explicit `language` in the
      // body still wins — callers that know which language they want keep
      // that control. When it's absent, fall back to the caller's own stored
      // UI-language preference rather than going straight to
      // DEFAULT_LANGUAGE, so a worker who switched the app to Arabic also
      // gets the Arabic notice without the client having to remember to pass
      // it on every call.
      //
      // Read here rather than in the service on purpose: this module is
      // frozen spec (SPEC-CONSENT-001) and owns notice content, not user
      // identity. Resolving "who is asking" is the controller's job, and
      // requestConsent's own unsupported-language fallback (OD-CONSENT-009)
      // still applies unchanged — which is exactly what handles a
      // preference of 'uk', a UI locale that CRR §32 does not carry.
      const bodyLanguage =
        typeof req.body?.language === 'string' ? req.body.language : undefined;
      const language = bodyLanguage ?? (await getPreferredLanguage(req.auth.userId));

      const result = await consentService.requestConsent(consentInstance, language);

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

  // ---------------------------------------------------------------------------
  // Gate state -- "does the daily consent gate apply to ME, right now?"
  // ---------------------------------------------------------------------------
  // Deliberately NOT part of IF-CONSENT-CheckStatus: that interface's response
  // shape is frozen spec (SPEC-CONSENT-001, granted/declined/absent), and
  // widening it would need a spec amendment. This is a separate operational
  // question -- whether enforcement is switched on -- not a consent decision.
  //
  // It exists so the documented kill switch actually reaches the UI. Turning
  // FEATURE_CONSENT_GATE off stops the API gating instantly, but a client that
  // decides purely from its own /consent/status read keeps every non-admin in
  // front of a notice they no longer need to accept.
  //
  // Returns ONE resolved boolean rather than the raw flag plus the role list,
  // so role logic stays server-side and cannot drift between three clients.
  // `enforced: false` means "do not show the gate" for THIS caller -- it is
  // already false for an admin, and for any role outside CONSENT_GATE_ROLES.
  async getGateState(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth) throw new UnauthorizedError();

      const role = String(req.auth.role ?? '').toLowerCase();
      const enforced =
        isConsentGateEnabled() && role !== 'admin' && getConsentGateRoles().includes(role);

      res.status(200).json({
        status: 'success',
        data: { enforced },
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const consentController = new ConsentController();

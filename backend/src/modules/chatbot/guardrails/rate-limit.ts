import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { getEnv } from '../../../config/env.js';
import { TooManyRequestsError } from '../../../lib/errors.js';

/**
 * Request-rate limiting for the chatbot, keyed on the AUTHENTICATED USER.
 *
 * WHY NOT IP, which is what `middleware/rateLimit.ts` uses for login. That
 * limiter defends an UNauthenticated endpoint, where the caller's identity is
 * exactly what is in dispute, so the source address is the only stable key
 * available. Here every route sits behind `authMiddleware`, so a better key
 * exists -- and IP would be actively wrong twice over:
 *
 *  - A hotel's staff share one office NAT. IP-keying would let one worker's
 *    runaway client throttle every colleague behind the same address, which
 *    is a self-inflicted outage, not a defense.
 *  - Cost and abuse are both attributable to a PERSON here (the token
 *    budgets in `budget.ts` are per user and per conversation). A limiter
 *    keyed on something other than the thing being bounded invites exactly
 *    the mismatch where one dimension is capped and the other is not.
 *
 * WHY THIS IS NOT REDUNDANT WITH THE TOKEN BUDGETS. `budget.ts` bounds what a
 * user may SPEND -- per conversation, per day (OD-CHAT-010's named abuse
 * shape), per month. It does not bound how FAST they may spend it. A client
 * stuck in a retry loop stays inside its daily cap and still issues hundreds
 * of requests in a minute, each one a synchronous upstream call held open for
 * up to `CHATBOT_TURN_TIMEOUT_MS`. That is a concurrency and latency problem
 * for every other user on a single-process backend, and it arrives long
 * before the cost cap notices. The two controls bound different axes and an
 * attacker has to be under both.
 *
 * It also covers a gap the budget genuinely cannot: a turn that fails BEFORE
 * `recordSpend` runs (provider timeout, validation rejection) advances no
 * counter at all, so a loop of failing turns is invisible to the budget while
 * still consuming a connection and an upstream call every time.
 *
 * STORE. `express-rate-limit`'s default store is in-process memory, which is
 * an accurate global limit ONLY because the backend runs single-process
 * (`ecosystem.config.js`: `instances: 1, exec_mode: 'fork'`). If that ever
 * becomes cluster mode with N workers, the effective limit silently becomes
 * N x max -- it would not fail, it would just stop bounding what it claims
 * to bound. `chatbot-rate-limit.test.ts` asserts the fork-mode assumption
 * against the real config file so the change cannot pass unnoticed.
 *
 * 429s are raised as the app's own `TooManyRequestsError`, matching the login
 * limiter, so a client sees one envelope and one Retry-After convention
 * regardless of which layer rejected it.
 */

/**
 * The rate-limit key: the authenticated user id.
 *
 * Falls back to the IP only if `req.auth` is somehow absent. That should be
 * unreachable -- these limiters are mounted after `authMiddleware` -- but
 * `express-rate-limit` treats an undefined key as a single shared bucket,
 * which would silently collapse every caller into one global limit and lock
 * out the whole platform. Failing to the IP degrades to the weaker-but-sane
 * behaviour instead of the catastrophic one.
 */
function keyByUser(req: Request): string {
  const userId = req.auth?.userId;
  return userId ? `user:${userId}` : `ip:${req.ip ?? 'unknown'}`;
}

function chatbotLimiter(max: number, what: string) {
  const windowMs = getEnv().CHATBOT_RATE_LIMIT_WINDOW_MS;

  // Fail loudly on a missing bound rather than accept one.
  // `express-rate-limit` treats an undefined `max` as its OWN default of 5,
  // which is not a safe fallback here -- it is a silently wrong one. Five
  // messages a minute reads to a user as the assistant randomly refusing to
  // answer, with nothing in the logs saying a limit was even applied, and
  // nothing failing at boot. The env schema always supplies these, so
  // reaching this means a caller constructed a limiter from a config that
  // does not have them; better to know at mount time than in production.
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(
      `chatbot rate limit misconfigured (max=${String(max)}, windowMs=${String(windowMs)}): ` +
        'CHATBOT_RATE_LIMIT_WINDOW_MS, CHATBOT_TURN_RATE_LIMIT_MAX and ' +
        'CHATBOT_ACTION_RATE_LIMIT_MAX must all be positive numbers.'
    );
  }

  return rateLimit({
    windowMs,
    max,
    keyGenerator: keyByUser,
    // Suppressed for the same reason as the login limiter: the app has its
    // own Retry-After convention, and two competing sets of rate-limit
    // headers are confusing rather than helpful.
    standardHeaders: false,
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(
        new TooManyRequestsError(
          `Too many chatbot ${what}. Please wait a moment and try again.`,
          Math.ceil(windowMs / 1000)
        )
      );
    },
  });
}

/** The metered path: every turn that may reach the model. */
export function chatbotTurnRateLimit() {
  return chatbotLimiter(getEnv().CHATBOT_TURN_RATE_LIMIT_MAX, 'messages');
}

/** Conversation creation and direct tool invocation — no model in the loop. */
export function chatbotActionRateLimit() {
  return chatbotLimiter(getEnv().CHATBOT_ACTION_RATE_LIMIT_MAX, 'requests');
}

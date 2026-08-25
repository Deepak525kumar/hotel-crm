// OD-CHAT-010 — named abuse shape: a single worker issuing many
// conversation-starts/turns, each individually under the per-conversation
// cap, can still collectively exhaust the *shared* monthly budget and force
// fallback for every other worker. CRR §2's "no login rate-limiting"
// exclusion is explicitly scoped to login attempts, not this cost-incurring
// endpoint (spec's own "Abuse-prevention note") — so it does not cover this
// case. This is a prototype-only defense-in-depth control, not a G2-ratified
// policy: a simple in-memory sliding window per worker per action.
// A true sliding window (timestamps of recent hits), not a fixed window — a
// fixed window lets a burst straddling the boundary reach 2x the stated
// ceiling, which matters here because the limit IS the abuse control.
const hits = new Map<string, number[]>();

export interface RateLimitConfig {
  windowMs: number;
  maxInWindow: number;
}

export const RATE_LIMITS = {
  conversationStart: { windowMs: 60 * 60 * 1000, maxInWindow: 5 } satisfies RateLimitConfig, // 5 starts/hour/worker
  exchangeMessage: { windowMs: 60 * 1000, maxInWindow: 20 } satisfies RateLimitConfig, // 20 turns/minute/worker
};

export function checkRateLimit(action: keyof typeof RATE_LIMITS, workerId: string): boolean {
  const config = RATE_LIMITS[action];
  const key = `${action}:${workerId}`;
  const now = Date.now();
  const cutoff = now - config.windowMs;

  const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= config.maxInWindow) {
    hits.set(key, recent);
    return false;
  }

  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function __resetRateLimitsForTests(): void {
  hits.clear();
}

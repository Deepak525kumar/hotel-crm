// Positive-only cache for the daily consent gate (RULE-CONSENT-01/02).
//
// Lives here rather than in middleware/consentGate.ts to break a cycle: the
// middleware imports ConsentService (to call checkStatus), and the service
// must invalidate on every recorded decision. Both import this leaf module
// instead, which imports nothing of theirs.
//
// Caches ONLY "granted". Never caching a negative is what makes the
// "accepted but still locked" bug structurally impossible: a worker who has
// just granted is unblocked on their very next request, with no invalidation
// race to lose. The invalidate-on-decision call below is belt-and-braces on
// top of that, not the primary mechanism.
//
// An entry is additionally valid only while its calendar date and notice
// version still match. That is what re-gates a session which crosses midnight
// Berlin time, or which spans a notice-version bump (RULE-CONSENT-02: a new
// day, or a new version, always requires fresh acceptance).
//
// Per-process. Under pm2 cluster mode invalidation is per-process too, so the
// worst case is bounded and benign: a grant->withdraw may retain access for
// up to the TTL on sibling processes. A *grant* always takes effect
// immediately everywhere, because no negative was ever cached. Not worth a
// Redis dependency (REDIS_URL is optional and unused for this class of thing).

export const CONSENT_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  calendarDate: string;
  noticeVersion: string;
  expiresAt: number;
}

const grantedCache = new Map<string, CacheEntry>();

/**
 * Record that this user's consent was verified as granted for `calendarDate`
 * under `noticeVersion`.
 */
export function cacheConsentGranted(
  userId: string,
  calendarDate: string,
  noticeVersion: string,
  now: number
): void {
  grantedCache.set(userId, {
    calendarDate,
    noticeVersion,
    expiresAt: now + CONSENT_CACHE_TTL_MS,
  });
}

/**
 * True only for a live entry matching today's calendar date and the current
 * notice version. A stale entry is evicted on read rather than left to rot.
 */
export function hasCachedConsentGrant(
  userId: string,
  calendarDate: string,
  noticeVersion: string,
  now: number
): boolean {
  const hit = grantedCache.get(userId);
  if (!hit) return false;
  if (
    hit.expiresAt <= now ||
    hit.calendarDate !== calendarDate ||
    hit.noticeVersion !== noticeVersion
  ) {
    grantedCache.delete(userId);
    return false;
  }
  return true;
}

/**
 * Drop a user's cached grant. Called by ConsentService after every recorded
 * decision and every withdrawal, so a withdrawal takes effect without waiting
 * out the TTL.
 */
export function invalidateConsentCache(userId: string): void {
  grantedCache.delete(userId);
}

/** Test seam. */
export function clearConsentCache(): void {
  grantedCache.clear();
}

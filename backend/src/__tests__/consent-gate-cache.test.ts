// Cache semantics for the consent gate.
//
// The cache exists to keep a per-request DB read off the hot path, but its
// correctness constraints are the interesting part: a worker who has just
// accepted must never stay locked, and a session must re-gate across a
// calendar-day rollover or a notice-version bump (RULE-CONSENT-02).

import {
  CONSENT_CACHE_TTL_MS,
  cacheConsentGranted,
  clearConsentCache,
  hasCachedConsentGrant,
  invalidateConsentCache,
} from '../lib/consent-gate-cache.js';

const TODAY = '2026-08-18';
const V = 'v1';
const T0 = 1_000_000;

beforeEach(() => clearConsentCache());

describe('positive-only caching', () => {
  it('returns a live grant', () => {
    cacheConsentGranted('w1', TODAY, V, T0);
    expect(hasCachedConsentGrant('w1', TODAY, V, T0 + 1_000)).toBe(true);
  });

  it('has nothing cached for a user who was never granted', () => {
    // Negatives are never written, which is what makes "accepted but still
    // locked" impossible: there is no stale 'blocked' entry to outlive the
    // acceptance.
    expect(hasCachedConsentGrant('never-granted', TODAY, V, T0)).toBe(false);
  });

  it('isolates users', () => {
    cacheConsentGranted('w1', TODAY, V, T0);
    expect(hasCachedConsentGrant('w2', TODAY, V, T0)).toBe(false);
  });
});

describe('expiry', () => {
  it('expires exactly at the TTL boundary', () => {
    cacheConsentGranted('w1', TODAY, V, T0);
    expect(hasCachedConsentGrant('w1', TODAY, V, T0 + CONSENT_CACHE_TTL_MS - 1)).toBe(true);
    expect(hasCachedConsentGrant('w1', TODAY, V, T0 + CONSENT_CACHE_TTL_MS)).toBe(false);
  });
});

describe('re-gating conditions (RULE-CONSENT-02)', () => {
  it('rejects an entry once the calendar day rolls over', () => {
    // A session open across midnight Berlin time must be re-gated even though
    // the entry is still within its TTL.
    cacheConsentGranted('w1', '2026-08-17', V, T0);
    expect(hasCachedConsentGrant('w1', '2026-08-18', V, T0 + 1_000)).toBe(false);
  });

  it('rejects an entry once the notice version is superseded', () => {
    cacheConsentGranted('w1', TODAY, 'v1', T0);
    expect(hasCachedConsentGrant('w1', TODAY, 'v2', T0 + 1_000)).toBe(false);
  });

  it('evicts the stale entry rather than leaving it to rot', () => {
    cacheConsentGranted('w1', '2026-08-17', V, T0);
    hasCachedConsentGrant('w1', '2026-08-18', V, T0);
    // Even asked for the original day again, it is gone.
    expect(hasCachedConsentGrant('w1', '2026-08-17', V, T0)).toBe(false);
  });
});

describe('invalidation', () => {
  it('drops a grant immediately — a withdrawal must not wait out the TTL', () => {
    cacheConsentGranted('w1', TODAY, V, T0);
    invalidateConsentCache('w1');
    expect(hasCachedConsentGrant('w1', TODAY, V, T0)).toBe(false);
  });

  it('only affects the named user', () => {
    cacheConsentGranted('w1', TODAY, V, T0);
    cacheConsentGranted('w2', TODAY, V, T0);
    invalidateConsentCache('w1');
    expect(hasCachedConsentGrant('w2', TODAY, V, T0)).toBe(true);
  });

  it('is safe for a user with nothing cached', () => {
    expect(() => invalidateConsentCache('nobody')).not.toThrow();
  });
});

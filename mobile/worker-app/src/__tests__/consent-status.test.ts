import { statusAction, statusDescription, statusLabelKey } from '@/lib/consent-status';
import type { ConsentStatus } from '@/types/api';

/**
 * SPEC-CONSENT-001@0.2.0 FROZEN (GD-17). Pins the status -> action mapping
 * the screen relies on: the screen must never present an action that
 * doesn't make sense for the current status (e.g. Grant/Decline before
 * Review, or both Review and Withdraw at once).
 */
describe('statusAction', () => {
  it('offers "review" for an absent (never decided) status', () => {
    const status: ConsentStatus = { status: 'absent' };
    expect(statusAction(status)).toBe('review');
  });

  it('offers "review-again" for a declined status', () => {
    const status: ConsentStatus = {
      status: 'declined',
      notice_version: 'v1',
      decided_at: '2026-08-01T00:00:00.000Z',
    };
    expect(statusAction(status)).toBe('review-again');
  });

  it('offers "withdraw" for a granted status', () => {
    const status: ConsentStatus = {
      status: 'granted',
      notice_version: 'v1',
      decided_at: '2026-08-01T00:00:00.000Z',
    };
    expect(statusAction(status)).toBe('withdraw');
  });
});

describe('statusLabelKey', () => {
  // Keys, not sentences: the copy itself is pinned by the catalogue-parity
  // test, so asserting English here would only duplicate that and would break
  // the moment a translator rewords the German source.
  it('maps each status to a distinct key', () => {
    expect(statusLabelKey({ status: 'absent' })).toBe('consent.statusUndecided');
    expect(statusLabelKey({ status: 'granted', notice_version: 'v1', decided_at: '2026-08-01T00:00:00.000Z' })).toBe('consent.statusGranted');
    expect(statusLabelKey({ status: 'declined', notice_version: 'v1', decided_at: '2026-08-01T00:00:00.000Z' })).toBe('consent.statusDeclined');
  });
});

describe('statusDescription', () => {
  it('returns null for an absent status (nothing to describe yet)', () => {
    expect(statusDescription({ status: 'absent' })).toBeNull();
  });

  it('includes the notice version for a granted status', () => {
    const description = statusDescription({
      status: 'granted',
      notice_version: 'v1',
      decided_at: '2026-08-01T00:00:00.000Z',
    });
    expect(description).toEqual({
      key: 'consent.decidedAt',
      values: { when: expect.any(String), version: 'v1' },
    });
  });
});

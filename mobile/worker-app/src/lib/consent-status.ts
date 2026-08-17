import type { ConsentStatus } from '@/types/api';

/**
 * These functions return translation KEYS (and, for the description, the
 * values to interpolate) rather than finished English sentences.
 *
 * The alternative -- calling `i18n.t` in here -- would pull react-i18next into
 * a module that this package's tests import under `testEnvironment: node`, and
 * would make the returned string depend on init order. Returning a key keeps
 * the module pure and directly testable, and leaves resolution to the one
 * component that renders it, where `t()` already re-runs on a language change.
 */
export function statusLabelKey(status: ConsentStatus): string {
  switch (status.status) {
    case 'granted':
      return 'consent.statusGranted';
    case 'declined':
      return 'consent.statusDeclined';
    case 'absent':
      return 'consent.statusUndecided';
  }
}

export interface ConsentDescription {
  key: string;
  values: Record<string, string>;
}

export function statusDescription(status: ConsentStatus): ConsentDescription | null {
  switch (status.status) {
    case 'granted':
      return {
        key: 'consent.decidedAt',
        values: {
          when: new Date(status.decided_at).toLocaleString(),
          version: status.notice_version,
        },
      };
    case 'declined':
      return {
        key: 'consent.declinedPreviously',
        values: { when: new Date(status.decided_at).toLocaleString() },
      };
    case 'absent':
      return null;
  }
}

// The one action valid for the current status — never both Review and
// Withdraw at once, never Grant/Decline shown before a notice is fetched.
// Extracted as a pure function (not inlined in JSX) so the status -> action
// mapping is directly testable without a component-rendering library.
export type ConsentAction = 'review' | 'review-again' | 'withdraw';

export function statusAction(status: ConsentStatus): ConsentAction {
  switch (status.status) {
    case 'granted':
      return 'withdraw';
    case 'declined':
      return 'review-again';
    case 'absent':
      return 'review';
  }
}

import type { TFunction } from 'i18next';

import { ApiError } from './api';

/**
 * SIR-GLOB-022 — translating transport-layer error messages.
 *
 * `lib/api.ts` runs outside React and has no access to `t()`, so it cannot
 * translate at throw time. Instead it throws with a stable `code` and sets
 * `isFallbackMessage` when the text is one of its own English literals rather
 * than something the server sent. This helper closes that loop at the display
 * layer, where `t` is available.
 *
 * The rule is deliberate and narrow:
 *
 * - server-supplied message -> shown verbatim. It is already localized
 *   server-side against the caller's language, and carries specific detail
 *   (validation errors, business-rule explanations) that a generic string
 *   would destroy. Re-translating it would be strictly worse for the user.
 * - client-side fallback -> translated by `code`.
 *
 * `fallbackKey` is the calling screen's own message for "this operation
 * failed" (e.g. `documents.loadFailed`). It is used when the error is not an
 * ApiError at all — a network failure, a thrown string — and when the code
 * has no mapping. Screens keep their specific copy; only the transport
 * layer's five English literals are replaced from the table below.
 */
const CODE_KEYS: Record<string, string> = {
  RATE_LIMITED: 'errors.tooManyRequests',
  SESSION_EXPIRED: 'errors.sessionExpired',
  TOKEN_REVOKED: 'errors.sessionRevoked',
  REFRESH_FAILED: 'errors.refreshFailed',
  UNKNOWN: 'errors.requestFailed',
};

export function translateApiError(
  error: unknown,
  t: TFunction,
  fallbackKey = 'errors.generic',
): string {
  if (error instanceof ApiError) {
    if (!error.isFallbackMessage) return error.message;
    const key = CODE_KEYS[error.code];
    if (key) return t(key) as string;
  }
  return t(fallbackKey) as string;
}

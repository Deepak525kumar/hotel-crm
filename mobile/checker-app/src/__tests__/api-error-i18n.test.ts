import { ApiError } from '../lib/api';
import { translateApiError } from '../lib/api-error-i18n';
import type { TFunction } from 'i18next';

// Returns the key itself, so assertions read as "which key was chosen".
const t = ((key: string) => key) as unknown as TFunction;

describe('translateApiError (SIR-GLOB-022)', () => {
  describe('client-side fallback messages are translated by code', () => {
    it.each([
      ['RATE_LIMITED', 'errors.tooManyRequests'],
      ['SESSION_EXPIRED', 'errors.sessionExpired'],
      ['TOKEN_REVOKED', 'errors.sessionRevoked'],
      ['REFRESH_FAILED', 'errors.refreshFailed'],
      ['UNKNOWN', 'errors.requestFailed'],
    ])('%s -> %s', (code, key) => {
      const err = new ApiError(code, 'some English literal', 500, true);
      expect(translateApiError(err, t)).toBe(key);
    });
  });

  describe('server-supplied messages are shown verbatim', () => {
    // The point of the flag: the server localizes its own messages and they
    // carry specific detail a generic string would destroy.
    it('returns the server message untouched even for a mapped code', () => {
      const err = new ApiError('UNKNOWN', 'Shift already checked in at 09:03', 409, false);
      expect(translateApiError(err, t)).toBe('Shift already checked in at 09:03');
    });

    it('defaults to not-a-fallback when the flag is omitted', () => {
      // Guards the constructor default: an ApiError built without the flag
      // must not have its message silently replaced.
      const err = new ApiError('UNKNOWN', 'server text', 500);
      expect(err.isFallbackMessage).toBe(false);
      expect(translateApiError(err, t)).toBe('server text');
    });
  });

  describe('fallbackKey — screens keep their own copy', () => {
    it('uses the screen fallback for a non-ApiError', () => {
      expect(translateApiError(new Error('net'), t, 'documents.loadFailed')).toBe(
        'documents.loadFailed',
      );
    });

    it('uses the screen fallback for an unmapped code', () => {
      const err = new ApiError('SOME_NEW_SERVER_CODE', 'Request failed', 500, true);
      expect(translateApiError(err, t, 'documents.loadFailed')).toBe('documents.loadFailed');
    });

    it('still prefers a mapped transport code over the screen fallback', () => {
      // A 429 is about the transport, not the screen's operation — the
      // rate-limit message is the more useful of the two.
      const err = new ApiError('RATE_LIMITED', 'Too many requests.', 429, true, 30);
      expect(translateApiError(err, t, 'documents.loadFailed')).toBe('errors.tooManyRequests');
    });

    it('still prefers a server message over the screen fallback', () => {
      const err = new ApiError('CONFLICT', 'Already checked in at 09:03', 409, false);
      expect(translateApiError(err, t, 'documents.loadFailed')).toBe('Already checked in at 09:03');
    });

    it('defaults to errors.generic when no fallbackKey is given', () => {
      expect(translateApiError(new Error('net'), t)).toBe('errors.generic');
    });
  });

  describe('non-ApiError inputs', () => {
    it.each([
      ['a plain Error', new Error('boom')],
      ['a string', 'boom'],
      ['null', null],
      ['undefined', undefined],
    ])('%s -> generic', (_label, value) => {
      expect(translateApiError(value, t)).toBe('errors.generic');
    });
  });

  it('keeps retryAfterSeconds addressable after the flag was inserted before it', () => {
    // isFallbackMessage was added as the 4th positional param, shifting
    // retryAfterSeconds to 5th. Every call site passes it positionally.
    const err = new ApiError('RATE_LIMITED', 'Too many requests.', 429, true, 30);
    expect(err.retryAfterSeconds).toBe(30);
    expect(err.isFallbackMessage).toBe(true);
  });
});

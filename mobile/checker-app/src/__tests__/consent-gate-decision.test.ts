import { shouldBypassConsentGate } from '@/lib/consent-gate-decision';
import type { ConsentStatus } from '@/types/api';

const granted = { status: 'granted' } as ConsentStatus;
const declined = { status: 'declined' } as ConsentStatus;
const absent = { status: 'absent' } as ConsentStatus;

const call = (o: Partial<Parameters<typeof shouldBypassConsentGate>[0]>) =>
  shouldBypassConsentGate({ isAdmin: false, status: null, statusUnknown: false, enforced: true, ...o });

describe('consent gate decision', () => {
  describe('blocks when consent state is KNOWN and not granted', () => {
    it.each([
      ['absent', absent],
      ['declined', declined],
    ])('%s blocks', (_l, status) => {
      expect(call({ status })).toBe(false);
    });
  });

  describe('proceeds', () => {
    it('granted', () => expect(call({ status: granted })).toBe(true));
    it('admin, even with no consent', () =>
      expect(call({ isAdmin: true, status: absent })).toBe(true));
    it('admin, even when declined', () =>
      expect(call({ isAdmin: true, status: declined })).toBe(true));
  });

  describe('fails OPEN when the status read failed', () => {
    // The kill switch (FEATURE_CONSENT_GATE=false) stops the API gating
    // instantly. A client that walled on its own consent read would keep every
    // non-admin in front of a notice they no longer need -- and if the consent
    // endpoints are what broke, that wall could not be dismissed.
    it('unknown status proceeds', () =>
      expect(call({ statusUnknown: true })).toBe(true));

    it('unknown status proceeds even with a stale not-granted status', () =>
      expect(call({ status: absent, statusUnknown: true })).toBe(true));
  });

  it('a null status alone does NOT fail open — that is the loading case', () => {
    // Guards against over-correcting: only an explicit read FAILURE may
    // bypass. Null-with-no-error is "still resolving", which the component
    // renders as a spinner, not as the app.
    expect(call({ status: null, statusUnknown: false })).toBe(false);
  });

  describe('kill switch: server says the gate is not enforced', () => {
    // FEATURE_CONSENT_GATE=false stops the API gating instantly. Without this
    // branch the client kept prompting from its own /consent/status read, so
    // the switch never reached the UI.
    it('proceeds even with no consent at all', () =>
      expect(call({ enforced: false, status: absent })).toBe(true));

    it('proceeds even after a decline', () =>
      expect(call({ enforced: false, status: declined })).toBe(true));

    it('still blocks when enforced is true and consent is absent', () =>
      expect(call({ enforced: true, status: absent })).toBe(false));
  });
});

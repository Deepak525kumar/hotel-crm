import { create } from 'zustand';

/**
 * A revision counter that forces ConsentGate to re-read consent state.
 *
 * ConsentGate holds its own `status`, and so does the consent screen. Those
 * two copies were never connected: withdrawing consent from inside the app
 * updated the screen's local state and left the gate believing consent was
 * still granted. The gate's three existing re-check triggers (a
 * CONSENT_REQUIRED response, AppState -> active, midnight rollover) all
 * happen to miss this case, so the worker kept a fully working UI until the
 * app was force-quit -- while the server was already refusing their calls.
 *
 * A counter rather than a shared `status`: the server is the authority on
 * consent, so the right response to "something changed" is to re-read it, not
 * to have one screen tell another what the answer is.
 */
interface ConsentRevisionState {
  revision: number;
  /** Bump after any action that can change consent state server-side. */
  invalidate: () => void;
}

export const useConsentRevisionStore = create<ConsentRevisionState>((set) => ({
  revision: 0,
  invalidate: () => set((s) => ({ revision: s.revision + 1 })),
}));

import type { ConsentStatus } from '@/types/api';

/**
 * Whether the app proceeds, or the consent wall is shown.
 *
 * A pure module rather than a branch inside the component, because this is the
 * whole control and it was previously wrong in a way that still rendered
 * fine: ConsentGate claimed to fail open on a load error but did not -- on
 * error `status` stayed null and `loading` went false, so it fell through to
 * the wall.
 *
 * `statusUnknown` means the /consent/status call ITSELF failed, so the client
 * cannot tell whether consent is required. It fails OPEN deliberately:
 *
 *  - The server is the real gate and still refuses every gated call, so this
 *    is not a bypass. It degrades to visible request failures, not a wall.
 *  - It is the only thing that lets the documented kill switch reach the UI.
 *    With FEATURE_CONSENT_GATE off the API stops gating at once, but a client
 *    that walls on its own consent read keeps every non-admin in front of a
 *    notice they no longer need -- and if the consent endpoints are what
 *    broke (the likely reason for pulling the switch), that wall cannot be
 *    dismissed at all.
 *
 * A KNOWN not-granted state ('absent' or 'declined') still blocks. Failing
 * open on uncertainty must not become failing open always.
 */
export function shouldBypassConsentGate(args: {
  isAdmin: boolean;
  status: ConsentStatus | null;
  statusUnknown: boolean;
}): boolean {
  return args.isAdmin || args.status?.status === 'granted' || args.statusUnknown;
}

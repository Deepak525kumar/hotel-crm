/**
 * ADR-065 (Universal Onboarding Gate), client half.
 *
 * A worker whose EmploymentRecord is not yet ACTIVE has no business in the
 * main app: they hold no assignments, no shifts and no scope, so every tab
 * renders an empty state and the real task -- uploading documents and
 * submitting for review -- was buried behind Profile -> View documents.
 * Before this gate the app let them straight in and merely showed a dismissible
 * "Onboarding Incomplete" card on the dashboard.
 *
 * Kept as a pure function, mirroring `consent-gate-decision.ts`: the routing
 * effect in AuthGuard is not reachable by any test in this package, and the
 * interesting part is the decision, not the redirect.
 */

/** Statuses the server can report on `User.employment_status`. */
export type EmploymentStatus = 'PENDING' | 'ACTIVE' | 'DEACTIVATED' | 'REJECTED' | 'DELETED';

/** Where a gated user belongs. Exported so AuthGuard and its test agree on it. */
export const ONBOARDING_ROUTE = '/onboarding';

export function shouldGateOnboarding(args: {
  /** `/auth/me`'s `employment_status`. Undefined/null when the account has no record. */
  status: string | null | undefined;
  /** Lower-cased role from `/auth/me`. */
  role: string | null | undefined;
}): boolean {
  const { status, role } = args;

  // Admins hold no EmploymentRecord by design (ADR-065 exempts them), so an
  // absent status is normal for them and must never gate.
  if (role === 'admin') return false;

  // Unknown status fails OPEN, deliberately, and for the same reason
  // ConsentGate does: `employment_status` is one optional field on one
  // response, and a transient shape change or an account whose record failed
  // to materialise would otherwise brick the app for that user with no way
  // out. The server is the real gate -- it refuses out-of-scope work whatever
  // this returns -- so failing open degrades to empty states, not to a
  // privilege escalation.
  if (status === null || status === undefined || status === '') return false;

  // ACTIVE is the only status that gets the full app. DELETED is included in
  // the gated set rather than special-cased: such an account should be seeing
  // the onboarding/status screen's explanation, not silently-empty tabs.
  return status !== 'ACTIVE';
}

/**
 * Whether a gated user is allowed to be on this route.
 *
 * The gate is a redirect, not a wall, so it must not fight the routes a gated
 * worker legitimately needs: the onboarding screen itself, the documents
 * screen it links to, and settings (which is how they change language or sign
 * out -- locking someone out of sign-out would be its own defect).
 */
export function isRouteAllowedWhileGated(pathname: string): boolean {
  const allowed = [ONBOARDING_ROUTE, '/documents', '/settings'];
  return allowed.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Routes a gate sent the user to, rather than routes the user chose.
 *
 * `returnTo` exists to restore where someone was heading when their session
 * lapsed. A gate destination is the opposite of that: nobody navigates to
 * /onboarding on purpose, they are put there. Capturing one produced a
 * cross-account bug -- a PENDING worker was redirected to /onboarding, logged
 * out from that screen (which is where the sign-out button lives), and
 * AuthGuard recorded returnTo=/onboarding. The next worker to sign in on that
 * device, ACTIVE and fully onboarded, was then sent straight to the onboarding
 * screen and had no way off it, because the gate only ever redirects gated
 * users TO onboarding and never non-gated users away. It survived until the
 * app was reloaded and router state was discarded.
 */
export function isGateOwnedRoute(pathname: string): boolean {
  const gateRoutes = [ONBOARDING_ROUTE, '/consent'];
  return gateRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Whether a user sitting on the onboarding screen should be sent into the app.
 *
 * The mirror of `shouldGateOnboarding`, and the half that was missing: the gate
 * only ever pushed gated users TOWARD onboarding, so anyone who arrived there
 * without being gated had no way off it. That is what made the cross-account
 * `returnTo` bug survive until the app was reloaded.
 *
 * Also covers a worker whose record turns ACTIVE while they sit on the screen.
 */
export function shouldLeaveOnboarding(args: {
  status: string | null | undefined;
  role: string | null | undefined;
  pathname: string;
}): boolean {
  if (args.pathname !== ONBOARDING_ROUTE) return false;
  return !shouldGateOnboarding({ status: args.status, role: args.role });
}

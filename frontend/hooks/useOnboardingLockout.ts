"use client";

import { useMyOnboarding } from "@/hooks/useMyOnboarding";

/**
 * Whether the signed-in user is still mid-onboarding and should therefore be
 * held to the onboarding surface only (owner decision, 2026-08-13): a user
 * who is not yet active sees My Onboarding, Settings and Profile — nothing
 * else. Once ACTIVE the whole app opens up normally.
 *
 * FAILS OPEN, deliberately. Only the three phases that positively mean "this
 * person is mid-onboarding" lock the app down:
 *
 *   documents | review | rejected  -> locked
 *   loading | none | active | inactive -> unrestricted
 *
 * `none` (no EmploymentRecord at all) must NOT lock, for two reasons found by
 * querying the live database rather than assumed:
 *   1. Admins have no EmploymentRecord by design — ADR-065's gate is for
 *      non-admin roles — so treating "no record" as "not onboarded" would
 *      lock every admin out of the entire application.
 *   2. 12 of 43 active non-admin accounts predate ADR-065's auto-creation and
 *      still have no record. They are legitimately working today; a naive
 *      "no record = not active" rule would lock all of them out at once.
 *
 * `loading` must not lock either, or every user would see the app collapse to
 * one nav item on each page load before it flickers back.
 *
 * `inactive` (DEACTIVATED/DELETED) is deliberately excluded too: that is a
 * different lifecycle state with its own handling, not an onboarding one, and
 * this rule is about people who have not yet *finished* onboarding — not
 * people whose employment later ended.
 */
export function useOnboardingLockout(): {
  /** True only when the user is provably mid-onboarding. */
  isLocked: boolean;
  /** Paths a locked user may still reach. */
  allowedPaths: readonly string[];
  /** Whether a given pathname is reachable for this user right now. */
  isPathAllowed: (pathname: string) => boolean;
} {
  const { phase } = useMyOnboarding();

  const isLocked = phase === "documents" || phase === "review" || phase === "rejected" || phase === "inactive";

  const isPathAllowed = (pathname: string) => {
    if (!isLocked) return true;
    // Denials are checked FIRST: /onboarding/review-queue sits under
    // /onboarding and would otherwise be swept in by the prefix rule below.
    // A mid-onboarding manager/RM still holds their role, so the nav's role
    // gate alone does not hide it — they would see a Review Queue tab while
    // their own application is still awaiting review.
    if (DENIED_WHILE_ONBOARDING.some((denied) => pathname === denied || pathname.startsWith(`${denied}/`))) {
      return false;
    }
    return ALLOWED_WHILE_ONBOARDING.some(
      (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
    );
  };

  return { isLocked, allowedPaths: ALLOWED_WHILE_ONBOARDING, isPathAllowed };
}

/**
 * The only routes a not-yet-active user may reach.
 *
 * `/onboarding` is their actual task; `/settings` and `/profile` are the
 * account surfaces every user keeps (a person mid-onboarding still needs to
 * change their password or fix their phone number).
 */
const ALLOWED_WHILE_ONBOARDING = ["/onboarding", "/settings", "/profile"] as const;

/**
 * Carved back OUT of the `/onboarding` prefix above.
 *
 * Reviewing other people's applications is not part of onboarding yourself.
 * A manager or RM who is still mid-onboarding holds the role the nav's role
 * gate checks, so without this they would see (and could open) the Review
 * Queue while their own application is still pending — which is exactly the
 * "newly created candidate sees the Review Queue tab" report this fixes.
 */
const DENIED_WHILE_ONBOARDING = ["/onboarding/review-queue"] as const;

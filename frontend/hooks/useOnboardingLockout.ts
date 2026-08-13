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

  const isLocked = phase === "documents" || phase === "review" || phase === "rejected";

  const isPathAllowed = (pathname: string) => {
    if (!isLocked) return true;
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
 * change their password or fix their phone number). `/onboarding/review-queue`
 * lives under `/onboarding` and would be matched by the prefix rule, but it is
 * unreachable for a locked user anyway: it is role-gated to
 * manager/regional_manager/admin AND, for a mid-onboarding manager/RM, would
 * simply render an empty queue. Left as-is rather than special-cased, since
 * excluding it would mean a manager who finishes onboarding mid-session sees
 * the entry appear only after a reload.
 */
const ALLOWED_WHILE_ONBOARDING = ["/onboarding", "/settings", "/profile"] as const;

"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOnboardingLockout } from "@/hooks/useOnboardingLockout";

/**
 * Keeps a not-yet-active user on the onboarding surface (owner decision,
 * 2026-08-13): while their onboarding is still in progress they may reach
 * only My Onboarding, Settings and Profile.
 *
 * This exists because hiding sidebar links is not access control — a user can
 * type a URL, follow a stale bookmark, or land on `/dashboard` from a
 * notification. The nav filter and this guard read the SAME
 * `useOnboardingLockout` rule, so the set of hidden links and the set of
 * blocked routes cannot drift apart.
 *
 * It is a UX boundary, not a security one: every route it covers is still
 * independently authorized server-side. Nothing here is load-bearing for
 * authorization, which is why failing open (see useOnboardingLockout) is the
 * right default — a wrongly-locked active employee is a far worse outcome
 * than a mid-onboarding user briefly seeing a page they have no data for.
 *
 * Redirects rather than rendering a "not allowed" screen: the user has
 * exactly one thing to do, so send them to it instead of making them find it.
 */
export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLocked, isPathAllowed } = useOnboardingLockout();

  const blocked = isLocked && !isPathAllowed(pathname);

  useEffect(() => {
    if (blocked) router.replace("/onboarding");
  }, [blocked, router]);

  // Render nothing on a blocked route rather than flashing its content for
  // the frame before the redirect commits.
  if (blocked) return null;

  return <>{children}</>;
}

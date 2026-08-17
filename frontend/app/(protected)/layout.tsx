import { AuthGuard } from "@/components/auth/AuthGuard";
import { OnboardingGuard } from "@/components/auth/OnboardingGuard";
import { AppShell } from "@/components/layout/AppShell";
import { ConsentGate } from "@/components/consent/ConsentGate";

/**
 * Layout for all authenticated routes. The `(protected)` route group
 * keeps these pages out of the URL while sharing the guard + app shell.
 *
 * OnboardingGuard sits INSIDE AppShell, not around it: a user held on the
 * onboarding surface still gets the normal chrome (sidebar, header, profile
 * menu) — only the page body is withheld. Wrapping the shell instead would
 * blank the whole screen mid-redirect.
 *
 * ConsentGate (RULE-CONSENT-01) sits outside OnboardingGuard: the daily
 * data-protection notice outranks onboarding, since it gates use of the
 * system itself rather than one surface within it. Like OnboardingGuard it
 * stays inside AppShell for the same reason — chrome remains, body is
 * withheld. The server enforces the block regardless; this is the UX half.
 */
export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <AppShell>
        <ConsentGate>
          <OnboardingGuard>{children}</OnboardingGuard>
        </ConsentGate>
      </AppShell>
    </AuthGuard>
  );
}

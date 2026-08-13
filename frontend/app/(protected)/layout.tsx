import { AuthGuard } from "@/components/auth/AuthGuard";
import { OnboardingGuard } from "@/components/auth/OnboardingGuard";
import { AppShell } from "@/components/layout/AppShell";

/**
 * Layout for all authenticated routes. The `(protected)` route group
 * keeps these pages out of the URL while sharing the guard + app shell.
 *
 * OnboardingGuard sits INSIDE AppShell, not around it: a user held on the
 * onboarding surface still gets the normal chrome (sidebar, header, profile
 * menu) — only the page body is withheld. Wrapping the shell instead would
 * blank the whole screen mid-redirect.
 */
export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <AppShell>
        <OnboardingGuard>{children}</OnboardingGuard>
      </AppShell>
    </AuthGuard>
  );
}

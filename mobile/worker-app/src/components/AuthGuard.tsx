import { useEffect } from 'react';
import { useRouter, useSegments, usePathname, useGlobalSearchParams } from 'expo-router';
import { useAuthStore } from '@/stores/auth-store';
import {
  shouldGateOnboarding,
  isRouteAllowedWhileGated,
  ONBOARDING_ROUTE,
} from '@/lib/onboarding-gate-decision';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isInitialized } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  useEffect(() => {
    if (!isInitialized) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      // Build the return URL
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value) searchParams.append(key, Array.isArray(value) ? value[0] : value);
      }
      const queryString = searchParams.toString();
      const returnTo = queryString ? `${pathname}?${queryString}` : pathname;
      
      router.replace({
        pathname: '/(auth)/login',
        params: { returnTo },
      });
    } else if (user && inAuthGroup) {
      router.replace('/(app)');
    } else if (
      // ADR-065: a worker who is not ACTIVE is redirected to onboarding rather
      // than dropped into tabs that can only render empty states. Before this,
      // the app let them all the way in and relied on a dismissible card on the
      // dashboard to tell them onboarding was incomplete.
      user &&
      shouldGateOnboarding({ status: user.employment_status, role: user.role }) &&
      !isRouteAllowedWhileGated(pathname)
    ) {
      router.replace(ONBOARDING_ROUTE);
    }
  }, [user, isInitialized, segments, pathname, params, router]);

  return <>{children}</>;
}

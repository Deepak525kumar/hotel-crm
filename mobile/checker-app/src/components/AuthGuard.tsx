import { useEffect } from 'react';
import { useRouter, useSegments, usePathname, useGlobalSearchParams } from 'expo-router';
import { useAuthStore } from '@/stores/auth-store';

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
    }
  }, [user, isInitialized, segments, pathname, params]);

  return <>{children}</>;
}

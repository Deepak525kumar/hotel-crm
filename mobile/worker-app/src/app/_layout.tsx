import { Stack, DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '@/stores/auth-store';
import { useLocaleStore } from '@/stores/locale-store';
// Side-effect import: initialises i18next before any screen calls useTranslation.
import '@/lib/i18n';
import { AuthGuard } from '@/components/AuthGuard';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { initialize, isInitialized } = useAuthStore();
  const user = useAuthStore((s) => s.user);
  const hydrateLocale = useLocaleStore((s) => s.hydrate);
  const reconcileLocale = useLocaleStore((s) => s.reconcileFromServer);
  const localeReconciled = useLocaleStore((s) => s.reconciled);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Apply any cached language choice before first paint, so the app does not
  // flash German at a worker who set it to Arabic.
  useEffect(() => {
    void hydrateLocale();
  }, [hydrateLocale]);

  // Once auth resolves, the stored preference (if any) wins over the cached
  // and device-negotiated guess. Runs whichever way auth settles: a signed-
  // out worker keeps their cached choice so the login screen is translated.
  useEffect(() => {
    if (!isInitialized || localeReconciled) return;
    void reconcileLocale(user?.preferred_language ?? null);
  }, [isInitialized, localeReconciled, user?.preferred_language, reconcileLocale]);

  useEffect(() => {
    if (isInitialized) {
      SplashScreen.hideAsync();
    }
  }, [isInitialized]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthGuard>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGuard>
    </ThemeProvider>
  );
}

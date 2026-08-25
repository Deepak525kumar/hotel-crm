import { Stack, DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
// Our hook, not React Native's: the navigation chrome (DarkTheme/DefaultTheme)
// must honour the user's theme setting too, or the header and tab bar stay in
// the OS scheme while every screen switches.
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '@/stores/auth-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';
// Side-effect import: initialises i18next before any screen calls useTranslation.
import '@/lib/i18n';
import { useTranslation } from 'react-i18next';
import { AuthGuard } from '@/components/AuthGuard';
import { ConsentGate } from '@/components/consent/ConsentGate';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const { initialize, isInitialized } = useAuthStore();
  const user = useAuthStore((s) => s.user);
  const hydrateLocale = useLocaleStore((s) => s.hydrate);
  const hydrateTheme = useThemeStore((s) => s.hydrate);
  const reconcileLocale = useLocaleStore((s) => s.reconcileFromServer);
  const localeReconciled = useLocaleStore((s) => s.reconciled);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Apply any cached language choice before first paint, so the app does not
  // flash German at a checker who set it to Arabic.
  useEffect(() => {
    void hydrateLocale();
  }, [hydrateLocale]);

  // Once auth resolves, the stored preference (if any) wins over the cached
  // and device-negotiated guess. Runs whichever way auth settles: a signed-out
  // checker keeps their cached choice so the login screen is translated.
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
        <ConsentGate>
          <Stack>
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(app)" options={{ headerShown: false }} />
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen
              name="attendance/[id]"
              options={{ title: t('nav.attendanceDetail'), headerShown: true }}
            />
            <Stack.Screen
              name="quality/[id]"
              options={{ title: t('nav.qualityCheck'), headerShown: true }}
            />
            <Stack.Screen name="verification/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="documents" options={{ headerShown: false }} />
            <Stack.Screen name="consent" options={{ headerShown: false }} />
            <Stack.Screen name="hr" options={{ headerShown: false }} />
          </Stack>
        </ConsentGate>
      </AuthGuard>
    </ThemeProvider>
  );
}

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
  const themeHydrated = useThemeStore((s) => s.hydrated);
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

  // Same reasoning for the stored light/dark choice: without this the app opens
  // in the OS scheme and then snaps to the user's setting once storage resolves.
  // It is also what flips `hydrated`, which gates hideAsync() below -- omitting
  // it holds the splash screen open forever.
  useEffect(() => {
    void hydrateTheme();
  }, [hydrateTheme]);

  // Once auth resolves, the stored preference (if any) wins over the cached
  // and device-negotiated guess. Runs whichever way auth settles: a signed-out
  // checker keeps their cached choice so the login screen is translated.
  useEffect(() => {
    if (!isInitialized || localeReconciled) return;
    void reconcileLocale(user?.preferred_language ?? null);
  }, [isInitialized, localeReconciled, user?.preferred_language, reconcileLocale]);

  // Also waits for the stored theme. Without it the app paints in the OS scheme
  // for the moment storage takes to answer, so a worker who chose dark sees a
  // white flash on every launch. The store sets `hydrated` even when storage
  // throws, so this cannot hold the splash screen open.
  useEffect(() => {
    if (isInitialized && themeHydrated) {
      SplashScreen.hideAsync();
    }
  }, [isInitialized, themeHydrated]);

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
            {/* ADR-065: the onboarding gate is universal for non-Admin roles.
                AuthGuard redirects a non-ACTIVE checker here. */}
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="rating/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="documents" options={{ headerShown: false }} />
            <Stack.Screen name="consent" options={{ headerShown: false }} />
            <Stack.Screen name="hr" options={{ headerShown: false }} />
          </Stack>
        </ConsentGate>
      </AuthGuard>
    </ThemeProvider>
  );
}

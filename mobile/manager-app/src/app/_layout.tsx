import { Stack, DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';

// Our hook, not React Native's: the navigation chrome must honour the user's
// theme setting too, or the header and tab bar stay in the OS scheme while
// every screen switches.
import {
  ToastProvider,
  useAuthStore,
  useColorScheme,
  useLocaleStore,
  useThemeStore,
} from '@hotel-crm/mobile-shared';
// Side-effect import: initialises i18next before any screen calls useTranslation.
import '@hotel-crm/mobile-shared/src/lib/i18n';

import { AuthGuard } from '@/components/AuthGuard';
import { ConsentGate } from '@/components/consent/ConsentGate';
import { UpdateChecker } from '@/components/UpdateChecker';

SplashScreen.preventAutoHideAsync();

/**
 * The route the app opens on.
 *
 * Named explicitly, and not because it looks tidy. worker-app shipped a bug
 * where the app opened on the Consent screen whether or not consent had been
 * given: expo-router's getSortedChildren() puts explicitly declared
 * <Stack.Screen> children ahead of file-system routes, and React Navigation
 * treats the first screen in a stack as the initial route when none is named.
 * index.tsx -- whose entire job is to redirect -- was never rendered at all.
 *
 * `anchor` is the current name; `initialRouteName` is still read as a
 * fallback, so both are given and a version move either way keeps working.
 */
export const unstable_settings = {
  anchor: 'index',
  initialRouteName: 'index',
};

export default function RootLayout() {
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
  // flash German at a manager who set it to Arabic.
  useEffect(() => {
    void hydrateLocale();
  }, [hydrateLocale]);

  // Same reasoning for the stored light/dark choice: without this the app
  // opens in the OS scheme and snaps to the user's setting once storage
  // resolves.
  useEffect(() => {
    void hydrateTheme();
  }, [hydrateTheme]);

  // Once auth resolves, the stored preference wins over the cached and
  // device-negotiated guess. Runs whichever way auth settles, so the login
  // screen is translated for a signed-out manager too.
  useEffect(() => {
    if (!isInitialized || localeReconciled) return;
    void reconcileLocale(user?.preferred_language ?? null);
  }, [isInitialized, localeReconciled, user?.preferred_language, reconcileLocale]);

  // Waits for the stored theme as well as auth. Without it the app paints in
  // the OS scheme for however long storage takes, so a manager who chose dark
  // sees a white flash on every launch. The store sets `hydrated` even when
  // storage throws, so this cannot hold the splash screen open forever.
  useEffect(() => {
    if (isInitialized && themeHydrated) {
      SplashScreen.hideAsync();
    }
  }, [isInitialized, themeHydrated]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <UpdateChecker>
        <AuthGuard>
          {/* PushRegistration is mounted INSIDE ConsentGate, never outside:
              registering a device token before the daily consent notice is
              accepted returns 403 CONSENT_REQUIRED, and the token is then
              silently absent for the rest of the session. */}
          <ConsentGate>
            <ToastProvider>
              <Stack screenOptions={{ headerShown: false }} />
            </ToastProvider>
          </ConsentGate>
        </AuthGuard>
      </UpdateChecker>
    </ThemeProvider>
  );
}

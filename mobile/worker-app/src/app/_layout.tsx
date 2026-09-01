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
import { AuthGuard } from '@/components/AuthGuard';
import { ConsentGate } from '@/components/consent/ConsentGate';
import { UpdateChecker } from '@/components/UpdateChecker';

SplashScreen.preventAutoHideAsync();

/**
 * The route the app opens on.
 *
 * Reported live: the app started on the Consent screen -- the one under
 * Profile -- whether or not consent had been given, so the dashboard was
 * never the landing screen. Cause: expo-router's getSortedChildren() places
 * EXPLICITLY DECLARED <Stack.Screen> children ahead of the file-system
 * routes, and React Navigation treats the first screen in a stack as its
 * initial route when none is named. This layout declares `consent` first
 * (purely to set headerShown), which silently made it the app's entry point
 * -- so index.tsx, whose whole job is to redirect to (app) or to login, was
 * never rendered at all.
 *
 * Naming the anchor fixes it without depending on the order options happen
 * to be declared in. `anchor` is this version's name for it;
 * `initialRouteName` is still read as a fallback (getRoutesCore.js), and both
 * are given so a version move in either direction keeps working.
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
  // flash German at a worker who set it to Arabic.
  useEffect(() => {
    void hydrateLocale();
  }, [hydrateLocale]);

  // Same reasoning for the stored light/dark choice: without this the app opens
  // in the OS scheme and then snaps to the user's setting once storage resolves.
  useEffect(() => {
    void hydrateTheme();
  }, [hydrateTheme]);

  // Once auth resolves, the stored preference (if any) wins over the cached
  // and device-negotiated guess. Runs whichever way auth settles: a signed-
  // out worker keeps their cached choice so the login screen is translated.
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
      <UpdateChecker>
        <AuthGuard>
          <ConsentGate>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="consent" options={{ headerShown: false }} />
              <Stack.Screen name="hr" options={{ headerShown: false }} />
              <Stack.Screen name="settings" options={{ headerShown: false }} />
            </Stack>
          </ConsentGate>
        </AuthGuard>
      </UpdateChecker>
    </ThemeProvider>
  );
}

import { Stack, DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '@/stores/auth-store';
import { useLocaleStore } from '@/stores/locale-store';
// Side-effect import: initialises i18next before any screen calls useTranslation.
import '@/lib/i18n';
import { useTranslation } from 'react-i18next';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { t } = useTranslation();
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
        <Stack.Screen
          name="rating/[id]"
          options={{ title: t('nav.rateWorker'), headerShown: true }}
        />
        {/*
          These three render their own <BackLink /> and title inside a
          SafeAreaView (the same chrome worker-app's copies use), so the
          native header is suppressed rather than given a nav.* title —
          two stacked headers otherwise. They existed as files here but
          were unreachable: unregistered and unlinked, and invisible to
          tsc because tsconfig.test.json never included src/app/**.
        */}
        <Stack.Screen name="verification/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="documents" options={{ headerShown: false }} />
        <Stack.Screen name="consent" options={{ headerShown: false }} />
        <Stack.Screen name="hr" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}

import { Alert, StyleSheet, ScrollView } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BackLink } from '@/components/BackLink';
import { LanguagePicker } from '@/components/LanguagePicker';
import { ThemePicker } from '@/components/ThemePicker';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import { useAuthStore } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';

/**
 * Settings.
 *
 * A stack route reached from the profile header, deliberately NOT a bottom tab:
 * the tab bar is for things a worker touches during a shift, and settings is
 * not one of them. Adding a fifth tab would also push the tab labels tighter on
 * a small phone for a screen visited about once.
 *
 * Groups the two preferences that were previously either buried or missing:
 * language (which used to sit at the bottom of the profile screen, below the
 * fold on a small phone) and appearance (which did not exist on mobile at all,
 * while the web app has always had a theme toggle).
 */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const email = useAuthStore((s) => s.user?.email);
  const [sending, setSending] = useState(false);

  // Emails a reset link rather than changing the password in place: the backend
  // has no authenticated change-password endpoint, and the emailed token is
  // what proves control of the address. The worker app previously had no route
  // to this at all once signed in, and the login screen's "Forgot password?"
  // opened EXPO_PUBLIC_FRONTEND_URL -- unset in practice, so it defaulted to
  // localhost and opened nothing on a phone.
  const resetPassword = () => {
    if (!email) return;
    Alert.alert(t('settings.resetPassword'), t('settings.resetPasswordBody', { email }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.send'),
        onPress: async () => {
          setSending(true);
          try {
            await api.auth.requestPasswordReset(email);
            Alert.alert(t('settings.resetPasswordSent'));
          } catch (error) {
            Alert.alert(translateApiError(error, t, 'settings.resetPasswordFailed'));
          } finally {
            setSending(false);
          }
        },
      },
    ]);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* The root Stack sets headerShown: false, so every screen supplies its
            own back affordance — BackLink is the shared one, and it flips the
            arrow for RTL locales. */}
        <BackLink />
        <ThemedText type="subtitle" style={styles.header}>
          {t('settings.title', 'Settings')}
        </ThemedText>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemePicker />
          <ThemedView style={styles.separator} />
          <LanguagePicker />
          <ThemedView style={styles.separator} />
          <Button
            label={t('settings.resetPassword')}
            variant="secondary"
            onPress={resetPassword}
            loading={sending}
            disabled={!email}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
            {t('settings.storedOnDevice', 'These preferences are saved on this device. Your language also syncs to your account.')}
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, marginBottom: Spacing.two },
  content: { padding: Spacing.three, paddingBottom: Spacing.five },
  separator: { height: Spacing.four },
  footer: { marginTop: Spacing.three },
});

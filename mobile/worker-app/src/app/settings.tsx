import { StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BackLink } from '@/components/BackLink';
import { LanguagePicker } from '@/components/LanguagePicker';
import { ThemePicker } from '@/components/ThemePicker';
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

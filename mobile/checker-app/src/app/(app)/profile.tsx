import { StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const theme = useTheme();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      router.replace('/(auth)/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (!user) return null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* Scrollable for the same reason as the worker app's profile: the
            language picker adds six rows plus two lines of copy, which pushes
            sign-out below the fold on a small phone. */}
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Settings lives here, top-right, rather than as a fifth bottom tab:
            the tab bar is for what a worker touches during a shift. */}
        <ThemedView style={styles.headerRow}>
          <ThemedText type="subtitle" style={styles.header}>{t("profile.title")}</ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.title', 'Settings')}
            onPress={() => router.push('/settings')}
            hitSlop={12}
            style={({ pressed }) => [styles.settingsButton, { opacity: pressed ? 0.7 : 1 }]}
          >
            <ThemedText type="subtitle">⚙</ThemedText>
          </Pressable>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedView style={styles.row} type="backgroundElement">
            <ThemedText type="small" themeColor="textSecondary">{t("fields.name")}</ThemedText>
            <ThemedText type="small">
              {user.first_name} {user.last_name}
            </ThemedText>
          </ThemedView>
          <ThemedView style={styles.divider} type="backgroundSelected" />
          <ThemedView style={styles.row} type="backgroundElement">
            <ThemedText type="small" themeColor="textSecondary">{t("auth.email")}</ThemedText>
            <ThemedText type="small">{user.email}</ThemedText>
          </ThemedView>
          <ThemedView style={styles.divider} type="backgroundSelected" />
          <ThemedView style={styles.row} type="backgroundElement">
            <ThemedText type="small" themeColor="textSecondary">{t("fields.role")}</ThemedText>
            <ThemedText type="small" style={styles.roleText}>
              {user.role}
            </ThemedText>
          </ThemedView>
          
          {user.creator_name && (
            <>
              <ThemedView style={styles.divider} type="backgroundSelected" />
              <ThemedView style={styles.row} type="backgroundElement">
                <ThemedText type="small" themeColor="textSecondary">{t("requests.createdBy")}</ThemedText>
                <ThemedText type="small">{user.creator_name}</ThemedText>
              </ThemedView>
            </>
          )}

          {user.manager_name && (
            <>
              <ThemedView style={styles.divider} type="backgroundSelected" />
              <ThemedView style={styles.row} type="backgroundElement">
                <ThemedText type="small" themeColor="textSecondary">{t("profile.directManager")}</ThemedText>
                <ThemedText type="small">{user.manager_name}</ThemedText>
              </ThemedView>
            </>
          )}
        </ThemedView>

        <Pressable
          onPress={() => router.push('/documents')}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.actionButton}>
            <ThemedText type="smallBold">{t('documents.view')}</ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          onPress={() => router.push('/consent')}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.actionButton}>
            <ThemedText type="smallBold">{t('consent.view')}</ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          onPress={() => router.push('/hr')}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.actionButton}>
            <ThemedText type="smallBold">{t('hr.view')}</ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          onPress={handleLogout}
          disabled={isLoggingOut}
          style={({ pressed }) => [{ opacity: pressed || isLoggingOut ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.logoutButton}>
            {isLoggingOut ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <ThemedText type="smallBold" style={styles.logoutText}>{t("profile.signOut")}</ThemedText>
            )}
          </ThemedView>
        </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  header: {
    paddingBottom: Spacing.two,
  },
  settingsButton: {
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  card: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  divider: {
    height: 1,
    marginHorizontal: Spacing.three,
  },
  roleText: {
    textTransform: 'capitalize',
  },
  actionButton: {
    height: 48,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutButton: {
    height: 48,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutText: {
    color: '#E53E3E',
  },
});

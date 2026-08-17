import { StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useState } from 'react';
import { LanguagePicker } from '@/components/LanguagePicker';
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
        {/* Scrollable: the language picker adds six rows plus two lines of
            explanatory copy to a screen that already carried a details card
            and five buttons. Without this the sign-out button sits below the
            fold on a small phone with no way to reach it. */}
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ThemedText type="subtitle" style={styles.header}>{t("profile.title")}</ThemedText>

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
          onPress={() => router.push('/ratings')}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.actionButton}>
            <ThemedText type="smallBold">{t('leaderboard.view')}</ThemedText>
          </ThemedView>
        </Pressable>

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

        <LanguagePicker />

        <Pressable
          onPress={handleLogout}
          disabled={isLoggingOut}
          style={({ pressed }) => [{ opacity: pressed || isLoggingOut ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.actionButton}>
            {isLoggingOut ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <ThemedText type="smallBold" style={styles.logoutText}>
                {t('profile.signOut')}
              </ThemedText>
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
  header: {
    paddingBottom: Spacing.two,
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
  logoutText: {
    color: '#E53E3E',
  },
});
